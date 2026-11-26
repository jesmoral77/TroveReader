//! Trove backend.
//!
//! The Rust side is deliberately thin: it owns the SQLite connection, walks and
//! watches library folders, and moves bytes between disk and the webview. All
//! library logic (schema, queries, reconciliation) lives in TypeScript so it can
//! be shared with the in-browser development backend.

use base64::Engine;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

/// File extensions Trove indexes.
const SUPPORTED: &[&str] = &[
    "pdf", "epub", "mobi", "azw", "azw3", "kf8", "fb2", "fbz", "cbz", "txt", "md", "markdown", "html", "htm",
];

struct Db(Mutex<Connection>);
struct WatcherState(Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);
struct Paths {
    covers: PathBuf,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

fn to_sql(v: &JsonValue) -> SqlValue {
    match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(*b as i64),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> JsonValue {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => JsonValue::Null,
        Integer(i) => JsonValue::from(i),
        Real(f) => JsonValue::from(f),
        Text(t) => JsonValue::from(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => JsonValue::from(base64::engine::general_purpose::STANDARD.encode(b)),
    }
}

#[derive(Serialize)]
struct ExecResult {
    rows_affected: usize,
    last_insert_id: i64,
}

#[derive(Deserialize)]
struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[tauri::command]
fn db_execute(db: State<Db>, sql: String, params: Vec<JsonValue>) -> CmdResult<ExecResult> {
    let conn = db.0.lock().map_err(err)?;
    let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let rows_affected = conn.execute(&sql, params_from_iter(p)).map_err(err)?;
    Ok(ExecResult { rows_affected, last_insert_id: conn.last_insert_rowid() })
}

#[tauri::command]
fn db_select(db: State<Db>, sql: String, params: Vec<JsonValue>) -> CmdResult<Vec<Map<String, JsonValue>>> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn.prepare_cached(&sql).map_err(err)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let p: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(params_from_iter(p)).map_err(err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i).map_err(err)?));
        }
        out.push(obj);
    }
    Ok(out)
}

/// Runs several statements atomically.
#[tauri::command]
fn db_batch(db: State<Db>, statements: Vec<Statement>) -> CmdResult<()> {
    let mut conn = db.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for s in statements {
        let p: Vec<SqlValue> = s.params.iter().map(to_sql).collect();
        if p.is_empty() && s.sql.contains(';') {
            tx.execute_batch(&s.sql).map_err(err)?;
        } else {
            tx.execute(&s.sql, params_from_iter(p)).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ScannedFile {
    path: String,
    size: u64,
    mtime: i64,
    ext: String,
    /// Content fingerprint; `None` when the caller already knows this file unchanged.
    hash: Option<String>,
}

/// Fast fingerprint: size + first 64 KiB + last 64 KiB. Good enough to spot
/// duplicates and files that were moved or renamed, without reading whole books.
fn quick_hash(path: &Path, size: u64) -> std::io::Result<String> {
    const CHUNK: u64 = 64 * 1024;
    let mut f = fs::File::open(path)?;
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    hasher.update(&size.to_le_bytes());
    let mut buf = vec![0u8; CHUNK as usize];
    let n = f.read(&mut buf)?;
    hasher.update(&buf[..n]);
    if size > CHUNK * 2 {
        f.seek(SeekFrom::End(-(CHUNK as i64)))?;
        let n = f.read(&mut buf)?;
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:016x}", hasher.digest()))
}

fn extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    SUPPORTED.contains(&ext.as_str()).then_some(ext)
}

fn describe(path: &Path, known: &HashMap<String, (u64, i64)>) -> Option<ScannedFile> {
    let ext = extension(path)?;
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let p = path.to_string_lossy().into_owned();
    let unchanged = matches!(known.get(&p), Some((s, m)) if *s == size && *m == mtime);
    let hash = if unchanged { None } else { quick_hash(path, size).ok() };
    Some(ScannedFile { path: p, size, mtime, ext, hash })
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0
        && entry
            .file_name()
            .to_str()
            .map(|s| s.starts_with('.') || s.starts_with('~') || s == "$RECYCLE.BIN" || s == "node_modules")
            .unwrap_or(false)
}

/// Recursively lists supported files under `root`.
/// `known` maps path -> (size, mtime) for files already indexed; those are not re-hashed.
#[tauri::command]
async fn scan_folder(root: String, known: HashMap<String, (u64, i64)>) -> CmdResult<Vec<ScannedFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        if !root.is_dir() {
            return Err(format!("Folder not found: {}", root.display()));
        }
        Ok(WalkDir::new(&root)
            .follow_links(true)
            .into_iter()
            .filter_entry(|e| !is_hidden(e))
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| describe(e.path(), &known))
            .collect())
    })
    .await
    .map_err(err)?
}

/// Describes individual files (used for files added outside watched folders).
/// Returns `null` for paths that no longer exist or are unsupported.
#[tauri::command]
fn stat_files(paths: Vec<String>) -> Vec<Option<ScannedFile>> {
    let none = HashMap::new();
    paths.iter().map(|p| describe(Path::new(p), &none)).collect()
}

#[tauri::command]
fn path_kind(path: String) -> &'static str {
    let p = Path::new(&path);
    if p.is_dir() {
        "dir"
    } else if p.is_file() {
        "file"
    } else {
        "missing"
    }
}

/// Streams a file's bytes to the webview as a raw binary response.
#[tauri::command]
async fn read_file(path: String) -> CmdResult<tauri::ipc::Response> {
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(&path))
        .await
        .map_err(err)?
        .map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> CmdResult<()> {
    fs::write(path, contents).map_err(err)
}

/// Saves a cover thumbnail (base64 JPEG/PNG) and returns its absolute path.
#[tauri::command]
fn save_cover(paths: State<Paths>, id: String, data: String) -> CmdResult<String> {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(err)?;
    let file = paths.covers.join(format!("{safe}.jpg"));
    fs::write(&file, bytes).map_err(err)?;
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_cover(paths: State<Paths>, id: String) {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let _ = fs::remove_file(paths.covers.join(format!("{safe}.jpg")));
}

/// (Re)starts watching the given folders. Emits `library-fs-changed` with the
/// changed paths (debounced) so the frontend can rescan.
#[tauri::command]
fn watch_folders(app: tauri::AppHandle, state: State<WatcherState>, folders: Vec<String>) -> CmdResult<()> {
    let mut guard = state.0.lock().map_err(err)?;
    *guard = None; // drop the previous watcher
    if folders.is_empty() {
        return Ok(());
    }
    let handle = app.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(1500), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<String> = events
                .into_iter()
                .filter(|e| e.path.is_dir() || extension(&e.path).is_some() || !e.path.exists())
                .map(|e| e.path.to_string_lossy().into_owned())
                .collect();
            if !paths.is_empty() {
                let _ = handle.emit("library-fs-changed", paths);
            }
        }
    })
    .map_err(err)?;
    for f in &folders {
        if Path::new(f).is_dir() {
            debouncer.watcher().watch(Path::new(f), RecursiveMode::Recursive).map_err(err)?;
        }
    }
    *guard = Some(debouncer);
    Ok(())
}

// ---------------------------------------------------------------------------
// KOReader progress sync
// ---------------------------------------------------------------------------

/// KOReader's document fingerprint ("Binary" matching): MD5 over 1 KiB samples
/// taken at offsets 0, 1 KiB, 4 KiB, 16 KiB … 1 GiB (1024 << 2i for i = -1..=10;
/// LuaJIT's shift wraps for i = -1, giving offset 0). Must match
/// koreader/frontend/util.lua `partialMD5` exactly.
fn partial_md5_of(path: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(path)?;
    let len = f.metadata()?.len();
    let mut ctx = md5::Context::new();
    let mut buf = vec![0u8; 1024];
    for i in -1i32..=10 {
        let offset: u64 = if i < 0 { 0 } else { 1024u64 << (2 * i as u64) };
        if offset >= len && !(offset == 0 && len == 0) {
            break;
        }
        f.seek(SeekFrom::Start(offset))?;
        let mut read = 0;
        while read < buf.len() {
            let n = f.read(&mut buf[read..])?;
            if n == 0 {
                break;
            }
            read += n;
        }
        if read == 0 {
            break;
        }
        ctx.consume(&buf[..read]);
    }
    Ok(format!("{:x}", ctx.finalize()))
}

#[tauri::command]
fn partial_md5(path: String) -> CmdResult<String> {
    partial_md5_of(Path::new(&path)).map_err(err)
}

#[tauri::command]
fn md5_hex(text: String) -> String {
    format!("{:x}", md5::compute(text.as_bytes()))
}

#[derive(Serialize)]
struct HttpResult {
    status: u16,
    body: JsonValue,
}

/// Calls a KOReader sync server (https://github.com/koreader/koreader-sync-server).
/// Done from Rust because those servers don't send CORS headers for webviews.
#[tauri::command]
async fn kosync_request(
    method: String,
    server: String,
    path: String,
    username: Option<String>,
    userkey: Option<String>,
    body: Option<JsonValue>,
) -> CmdResult<HttpResult> {
    let url = format!("{}/{}", server.trim_end_matches('/'), path.trim_start_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("Trove/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(err)?;
    let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(err)?;
    let mut req = client.request(m, &url).header("Accept", "application/vnd.koreader.v1+json");
    if let (Some(u), Some(k)) = (username, userkey) {
        req = req.header("x-auth-user", u).header("x-auth-key", k);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| format!("Could not reach the sync server: {e}"))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let body = serde_json::from_str(&text).unwrap_or(JsonValue::String(text));
    Ok(HttpResult { status, body })
}

/// Files passed on the command line (e.g. "Open with Trove" from Explorer).
fn file_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).is_file())
        .cloned()
        .collect()
}

#[tauri::command]
fn launch_files() -> Vec<String> {
    file_args(&std::env::args().collect::<Vec<_>>())
}

// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = file_args(&argv);
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let covers = data_dir.join("covers");
            fs::create_dir_all(&covers)?;
            let conn = Connection::open(data_dir.join("library.db"))?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
            app.manage(Db(Mutex::new(conn)));
            app.manage(Paths { covers });
            app.manage(WatcherState(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_execute,
            db_select,
            db_batch,
            scan_folder,
            stat_files,
            path_kind,
            read_file,
            write_text_file,
            save_cover,
            delete_cover,
            watch_folders,
            launch_files,
            partial_md5,
            md5_hex,
            kosync_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trove");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected values come from scripts/partial_md5.py, a direct port of KOReader's util.partialMD5.
    #[test]
    fn partial_md5_matches_koreader() {
        let dir = std::env::temp_dir().join("trove-md5-test");
        fs::create_dir_all(&dir).unwrap();
        for (name, len, expected) in [
            ("empty", 0usize, "d41d8cd98f00b204e9800998ecf8427e"),
            ("small", 700, "9f417fa3f2ce1c4216d3ecf25360384b"),
            ("mid", 70_000, "5665fa6ed861428352f7dc6a4a869729"),
            ("big", 3_000_000, "81a460d994652927f0a27f19ef681fe0"),
        ] {
            let p = dir.join(name);
            let data: Vec<u8> = (0..len).map(|i| (i * 7 % 251) as u8).collect();
            fs::write(&p, &data).unwrap();
            assert_eq!(partial_md5_of(&p).unwrap(), expected, "{name}");
        }
    }

    /// Run with a sync server: TROVE_KOSYNC_TEST=http://127.0.0.1:8765 cargo test kosync -- --ignored
    #[test]
    #[ignore]
    fn kosync_round_trip() {
        let server = std::env::var("TROVE_KOSYNC_TEST").expect("TROVE_KOSYNC_TEST");
        tauri::async_runtime::block_on(async {
            let key = md5_hex("secret".into());
            let r = kosync_request("POST".into(), server.clone(), "/users/create".into(), None, None,
                Some(serde_json::json!({"username": "rust-test", "password": key}))).await.unwrap();
            assert!(r.status == 201 || r.status == 402);
            let r = kosync_request("GET".into(), server.clone(), "users/auth".into(), Some("rust-test".into()), Some(key.clone()), None).await.unwrap();
            assert_eq!(r.status, 200);
            let r = kosync_request("PUT".into(), server.clone() + "/", "/syncs/progress".into(), Some("rust-test".into()), Some(key.clone()),
                Some(serde_json::json!({"document": "abc", "progress": "7", "percentage": 0.25, "device": "Trove", "device_id": "X"}))).await.unwrap();
            assert_eq!(r.status, 200);
            let r = kosync_request("GET".into(), server, "/syncs/progress/abc".into(), Some("rust-test".into()), Some(key), None).await.unwrap();
            assert_eq!(r.body["progress"], "7");
        });
    }
}

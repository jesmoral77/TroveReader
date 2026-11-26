import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { Backend, HttpResult, Row, ScannedFile, SqlParam } from './backend'

const EXTENSIONS = ['pdf', 'epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'cbz', 'txt', 'md', 'markdown', 'html', 'htm']

export function createTauriBackend(): Backend {
  return {
    isDesktop: true,

    async execute(sql, params = []) {
      const r = await invoke<{ rows_affected: number; last_insert_id: number }>('db_execute', { sql, params })
      return { rowsAffected: r.rows_affected, lastInsertId: r.last_insert_id }
    },
    select<T = Row>(sql: string, params: SqlParam[] = []) {
      return invoke<T[]>('db_select', { sql, params })
    },
    batch(statements) {
      return invoke('db_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) })
    },

    scanFolder(root, known) {
      return invoke<ScannedFile[]>('scan_folder', { root, known })
    },
    statFiles(paths) {
      return invoke<(ScannedFile | null)[]>('stat_files', { paths })
    },
    pathKind(path) {
      return invoke('path_kind', { path })
    },
    async readFile(path) {
      return invoke<ArrayBuffer>('read_file', { path })
    },
    writeTextFile(path, contents) {
      return invoke('write_text_file', { path, contents })
    },

    saveCover(id, data) {
      return invoke<string>('save_cover', { id, data })
    },
    deleteCover(id) {
      return invoke('delete_cover', { id })
    },
    coverUrl(path) {
      return convertFileSrc(path)
    },

    watchFolders(folders) {
      return invoke('watch_folders', { folders })
    },
    launchFiles() {
      return invoke<string[]>('launch_files')
    },
    onFsChanged(cb) {
      return listen<string[]>('library-fs-changed', (e) => cb(e.payload))
    },
    onOpenFiles(cb) {
      return listen<string[]>('open-files', (e) => cb(e.payload))
    },
    onFileDrop(cb, hover) {
      return getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload
        if (p.type === 'enter' || p.type === 'over') hover?.(true)
        else if (p.type === 'leave') hover?.(false)
        else if (p.type === 'drop') {
          hover?.(false)
          cb(p.paths)
        }
      })
    },

    partialMd5(path) {
      return invoke<string>('partial_md5', { path })
    },
    md5(text) {
      return invoke<string>('md5_hex', { text })
    },
    kosync(req) {
      return invoke<HttpResult>('kosync_request', {
        method: req.method,
        server: req.server,
        path: req.path,
        username: req.username ?? null,
        userkey: req.userkey ?? null,
        body: req.body ?? null,
      })
    },

    async pickFolder() {
      const r = await open({ directory: true, multiple: false, title: 'Add a folder to your library' })
      return typeof r === 'string' ? r : null
    },
    async pickFiles() {
      const r = await open({
        multiple: true,
        title: 'Add files to your library',
        filters: [{ name: 'Books & documents', extensions: EXTENSIONS }],
      })
      if (!r) return []
      return Array.isArray(r) ? r : [r]
    },
    async pickSavePath(defaultName, ext) {
      return save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    },
    confirm(message, title = 'Trove') {
      return ask(message, { title, kind: 'warning' })
    },
    reveal(path) {
      return revealItemInDir(path)
    },
    setTitle(title) {
      return getCurrentWindow().setTitle(title)
    },
  }
}

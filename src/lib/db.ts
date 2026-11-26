import { api, type Row, type SqlParam } from './backend'
import type {
  Annotation,
  Book,
  BookType,
  CoverMode,
  Format,
  HighlightColor,
  LibraryFolder,
  Progress,
  ReadingSession,
  Shelf,
} from './types'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    hash TEXT,
    format TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    type TEXT NOT NULL DEFAULT 'unsorted',
    type_auto INTEGER NOT NULL DEFAULT 1,
    pages INTEGER,
    cover_path TEXT,
    cover_mode TEXT NOT NULL DEFAULT 'auto',
    starred INTEGER NOT NULL DEFAULT 0,
    finished_at INTEGER,
    added_at INTEGER NOT NULL,
    opened_at INTEGER,
    missing INTEGER NOT NULL DEFAULT 0,
    excluded INTEGER NOT NULL DEFAULT 0,
    meta_done INTEGER NOT NULL DEFAULT 0,
    edited INTEGER NOT NULL DEFAULT 0,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    description TEXT,
    publisher TEXT,
    language TEXT,
    year TEXT
  );
  CREATE INDEX IF NOT EXISTS books_hash ON books(hash);
  CREATE TABLE IF NOT EXISTS shelves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES shelves(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS book_shelves (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, shelf_id)
  );
  CREATE TABLE IF NOT EXISTS progress (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    locator TEXT,
    fraction REAL NOT NULL DEFAULT 0,
    label TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    locator TEXT NOT NULL,
    text TEXT,
    note TEXT,
    color TEXT NOT NULL DEFAULT 'yellow',
    label TEXT,
    fraction REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS annotations_book ON annotations(book_id);
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    start_fraction REAL NOT NULL,
    end_fraction REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_book ON sessions(book_id);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
]

export async function migrate() {
  const b = api()
  await b.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const rows = await b.select<{ version: number }>('SELECT version FROM schema_version')
  let version = rows[0]?.version ?? 0
  if (!rows.length) await b.execute('INSERT INTO schema_version (version) VALUES (0)')
  while (version < MIGRATIONS.length) {
    await b.batch([{ sql: MIGRATIONS[version] }, { sql: 'UPDATE schema_version SET version = ?', params: [version + 1] }])
    version++
  }
  // Create the default shelf groups on first run.
  const shelves = await b.select('SELECT id FROM shelves LIMIT 1')
  if (!shelves.length) {
    const now = Date.now()
    await b.batch([
      { sql: 'INSERT INTO shelves (parent_id, name, sort, created_at) VALUES (NULL, ?, 0, ?)', params: ['Projects', now] },
      { sql: 'INSERT INTO shelves (parent_id, name, sort, created_at) VALUES (NULL, ?, 1, ?)', params: ['Topics', now] },
    ])
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const num = (v: unknown) => (v == null ? null : Number(v))
const str = (v: unknown) => (v == null ? null : String(v))

export function rowToBook(r: Row): Book {
  let authors: string[] = []
  try {
    authors = JSON.parse(String(r.authors ?? '[]'))
  } catch {
    authors = []
  }
  return {
    id: String(r.id),
    path: String(r.path),
    hash: str(r.hash),
    format: String(r.format) as Format,
    size: Number(r.size),
    mtime: Number(r.mtime),
    title: String(r.title),
    authors,
    type: String(r.type) as BookType,
    pages: num(r.pages),
    coverPath: str(r.cover_path),
    coverMode: String(r.cover_mode) as CoverMode,
    starred: !!Number(r.starred),
    finishedAt: num(r.finished_at),
    addedAt: Number(r.added_at),
    openedAt: num(r.opened_at),
    missing: !!Number(r.missing),
    excluded: !!Number(r.excluded),
    metaDone: !!Number(r.meta_done),
    folderId: num(r.folder_id),
    description: str(r.description),
    publisher: str(r.publisher),
    language: str(r.language),
    year: str(r.year),
  }
}

const rowToAnnotation = (r: Row): Annotation => ({
  id: String(r.id),
  bookId: String(r.book_id),
  kind: String(r.kind) as Annotation['kind'],
  locator: String(r.locator),
  text: str(r.text),
  note: str(r.note),
  color: String(r.color) as HighlightColor,
  label: str(r.label),
  fraction: num(r.fraction),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
})

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function loadAll() {
  const b = api()
  const [books, folders, shelves, links, progress, annotations] = await Promise.all([
    b.select('SELECT * FROM books WHERE excluded = 0'),
    b.select('SELECT * FROM folders ORDER BY path'),
    b.select('SELECT * FROM shelves ORDER BY sort, name COLLATE NOCASE'),
    b.select('SELECT book_id, shelf_id FROM book_shelves'),
    b.select('SELECT * FROM progress'),
    b.select('SELECT * FROM annotations ORDER BY created_at'),
  ])
  return {
    books: books.map(rowToBook),
    folders: folders.map((r): LibraryFolder => ({ id: Number(r.id), path: String(r.path), addedAt: Number(r.added_at) })),
    shelves: shelves.map(
      (r): Shelf => ({ id: Number(r.id), parentId: num(r.parent_id), name: String(r.name), sort: Number(r.sort) }),
    ),
    links: links.map((r) => [String(r.book_id), Number(r.shelf_id)] as [string, number]),
    progress: progress.map(
      (r): Progress => ({
        bookId: String(r.book_id),
        locator: str(r.locator),
        fraction: Number(r.fraction),
        label: str(r.label),
        updatedAt: Number(r.updated_at),
      }),
    ),
    annotations: annotations.map(rowToAnnotation),
  }
}

export async function getBook(id: string) {
  const rows = await api().select('SELECT * FROM books WHERE id = ?', [id])
  return rows[0] ? rowToBook(rows[0]) : null
}

const BOOK_COLUMNS: Partial<Record<keyof Book, string>> = {
  path: 'path',
  hash: 'hash',
  size: 'size',
  mtime: 'mtime',
  title: 'title',
  authors: 'authors',
  type: 'type',
  pages: 'pages',
  coverPath: 'cover_path',
  coverMode: 'cover_mode',
  starred: 'starred',
  finishedAt: 'finished_at',
  openedAt: 'opened_at',
  missing: 'missing',
  excluded: 'excluded',
  metaDone: 'meta_done',
  folderId: 'folder_id',
  description: 'description',
  publisher: 'publisher',
  language: 'language',
  year: 'year',
}

export function bookUpdateStatement(id: string, patch: Partial<Book>, extra: Record<string, SqlParam> = {}) {
  const sets: string[] = []
  const params: SqlParam[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = BOOK_COLUMNS[k as keyof Book]
    if (!col) continue
    sets.push(`${col} = ?`)
    params.push(k === 'authors' ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : (v as SqlParam))
  }
  for (const [col, v] of Object.entries(extra)) {
    sets.push(`${col} = ?`)
    params.push(v)
  }
  params.push(id)
  return { sql: `UPDATE books SET ${sets.join(', ')} WHERE id = ?`, params }
}

export async function updateBook(id: string, patch: Partial<Book>, extra: Record<string, SqlParam> = {}) {
  const s = bookUpdateStatement(id, patch, extra)
  if (s.sql.includes('SET  WHERE')) return
  await api().execute(s.sql, s.params)
}

export function insertBookStatement(b: Book) {
  return {
    sql: `INSERT INTO books (id, path, hash, format, size, mtime, title, authors, type, added_at, folder_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [b.id, b.path, b.hash, b.format, b.size, b.mtime, b.title, JSON.stringify(b.authors), b.type, b.addedAt, b.folderId],
  }
}

export async function saveProgress(p: Progress) {
  await api().execute(
    `INSERT INTO progress (book_id, locator, fraction, label, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET locator = excluded.locator, fraction = excluded.fraction,
       label = excluded.label, updated_at = excluded.updated_at`,
    [p.bookId, p.locator, p.fraction, p.label, p.updatedAt],
  )
}

export async function clearProgress(bookId: string) {
  await api().execute('DELETE FROM progress WHERE book_id = ?', [bookId])
}

export async function saveAnnotation(a: Annotation) {
  await api().execute(
    `INSERT INTO annotations (id, book_id, kind, locator, text, note, color, label, fraction, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET note = excluded.note, color = excluded.color, text = excluded.text,
       label = excluded.label, updated_at = excluded.updated_at`,
    [a.id, a.bookId, a.kind, a.locator, a.text, a.note, a.color, a.label, a.fraction, a.createdAt, a.updatedAt],
  )
}

export async function deleteAnnotation(id: string) {
  await api().execute('DELETE FROM annotations WHERE id = ?', [id])
}

export async function saveSession(s: ReadingSession) {
  await api().execute(
    'INSERT INTO sessions (book_id, started_at, ended_at, start_fraction, end_fraction) VALUES (?, ?, ?, ?, ?)',
    [s.bookId, s.startedAt, s.endedAt, s.startFraction, s.endFraction],
  )
}

export async function loadSessions(bookId: string): Promise<ReadingSession[]> {
  const rows = await api().select('SELECT * FROM sessions WHERE book_id = ? ORDER BY started_at', [bookId])
  return rows.map((r) => ({
    bookId: String(r.book_id),
    startedAt: Number(r.started_at),
    endedAt: Number(r.ended_at),
    startFraction: Number(r.start_fraction),
    endFraction: Number(r.end_fraction),
  }))
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await api().select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  if (!rows.length) return fallback
  try {
    return JSON.parse(rows[0].value) as T
  } catch {
    return fallback
  }
}

export async function setSetting(key: string, value: unknown) {
  await api().execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  )
}

export async function batchAddLinks(bookIds: string[], shelfId: number, now: number) {
  await api().batch(
    bookIds.map((id) => ({
      sql: 'INSERT OR IGNORE INTO book_shelves (book_id, shelf_id, added_at) VALUES (?, ?, ?)',
      params: [id, shelfId, now],
    })),
  )
}

export async function batchRemoveLinks(bookIds: string[], shelfId: number) {
  await api().batch(
    bookIds.map((id) => ({ sql: 'DELETE FROM book_shelves WHERE book_id = ? AND shelf_id = ?', params: [id, shelfId] })),
  )
}

export async function insertShelf(parentId: number | null, name: string, sort: number) {
  const r = await api().execute('INSERT INTO shelves (parent_id, name, sort, created_at) VALUES (?, ?, ?, ?)', [
    parentId,
    name,
    sort,
    Date.now(),
  ])
  return r.lastInsertId
}

export async function renameShelf(id: number, name: string) {
  await api().execute('UPDATE shelves SET name = ? WHERE id = ?', [name, id])
}

export async function deleteShelf(id: number) {
  await api().execute('DELETE FROM shelves WHERE id = ?', [id])
}

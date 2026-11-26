/**
 * Library indexing: folders are indexed in place. Files are never copied or
 * moved; Trove remembers their paths and fingerprints so it can follow files
 * that are renamed or moved within the library, and flags ones that vanish.
 */
import { api, type ScannedFile, type SqlParam } from './backend'
import * as db from './db'
import { autoType, extractMetadata, formatFromExt, titleFromPath } from './metadata'
import { reloadLibrary, setStatus, toast, useStore, patchBooksLocal } from './store'
import type { Book, LibraryFolder } from './types'

const lower = (p: string) => p.replace(/\//g, '\\').toLowerCase()
const isUnder = (path: string, folder: string) => {
  const f = lower(folder).replace(/\\+$/, '') + '\\'
  return lower(path).startsWith(f)
}

function newBook(f: ScannedFile, folderId: number | null): Book | null {
  const format = formatFromExt(f.ext)
  if (!format) return null
  return {
    id: crypto.randomUUID(),
    path: f.path,
    hash: f.hash,
    format,
    size: f.size,
    mtime: f.mtime,
    title: titleFromPath(f.path),
    authors: [],
    type: autoType(format, null),
    pages: null,
    coverPath: null,
    coverMode: 'auto',
    starred: false,
    finishedAt: null,
    addedAt: Date.now(),
    openedAt: null,
    missing: false,
    excluded: false,
    metaDone: false,
    folderId,
    description: null,
    publisher: null,
    language: null,
    year: null,
  }
}

async function allBooksIncludingExcluded() {
  const rows = await api().select('SELECT * FROM books')
  return rows.map(db.rowToBook)
}

type Stmt = { sql: string; params?: SqlParam[] }

/** Brings the DB in line with what is on disk for one folder. */
async function reconcileFolder(folder: LibraryFolder, all: Book[]): Promise<{ added: number; missing: number }> {
  const inFolder = all.filter((b) => b.folderId === folder.id || isUnder(b.path, folder.path))
  const known: Record<string, [number, number]> = {}
  for (const b of inFolder) if (!b.missing) known[b.path] = [b.size, b.mtime]

  const scanned = await api().scanFolder(folder.path, known)
  const byPath = new Map(inFolder.map((b) => [lower(b.path), b]))
  const seen = new Set<string>()
  const stmts: Stmt[] = []
  const fresh: ScannedFile[] = []

  for (const f of scanned) {
    const existing = byPath.get(lower(f.path))
    if (!existing) {
      fresh.push(f)
      continue
    }
    seen.add(existing.id)
    const changed = f.hash != null && f.hash !== existing.hash
    if (changed || existing.missing || existing.folderId !== folder.id) {
      stmts.push(
        db.bookUpdateStatement(existing.id, {
          size: f.size,
          mtime: f.mtime,
          hash: f.hash ?? existing.hash,
          missing: false,
          folderId: folder.id,
          ...(changed ? { metaDone: false } : {}),
        }),
      )
    }
  }

  // Files that disappeared from their old path are candidates for a move/rename.
  const vanished = inFolder.filter((b) => !seen.has(b.id))
  const relinkPool = new Map<string, Book>()
  for (const b of [...vanished, ...all.filter((x) => x.missing)]) if (b.hash) relinkPool.set(b.hash, b)

  let added = 0
  for (const f of fresh) {
    const moved = f.hash ? relinkPool.get(f.hash) : undefined
    if (moved) {
      relinkPool.delete(f.hash!)
      seen.add(moved.id)
      stmts.push(
        db.bookUpdateStatement(moved.id, { path: f.path, size: f.size, mtime: f.mtime, missing: false, folderId: folder.id }),
      )
      continue
    }
    const b = newBook(f, folder.id)
    if (b) {
      stmts.push(db.insertBookStatement(b))
      added++
    }
  }

  let missing = 0
  for (const b of vanished) {
    if (!seen.has(b.id) && !b.missing) {
      stmts.push(db.bookUpdateStatement(b.id, { missing: true }))
      missing++
    }
  }

  if (stmts.length) await api().batch(stmts)
  return { added, missing }
}

/** Re-checks books that were added individually (outside any library folder). */
async function reconcileLooseFiles(all: Book[]) {
  const loose = all.filter((b) => b.folderId == null && !b.excluded)
  if (!loose.length) return
  const stats = await api().statFiles(loose.map((b) => b.path))
  const stmts: Stmt[] = []
  loose.forEach((b, i) => {
    const s = stats[i]
    if (!s && !b.missing) stmts.push(db.bookUpdateStatement(b.id, { missing: true }))
    else if (s && b.missing) stmts.push(db.bookUpdateStatement(b.id, { missing: false }))
  })
  if (stmts.length) await api().batch(stmts)
}

let scanning: Promise<void> | null = null
let rescanQueued = false

export async function rescanAll(): Promise<void> {
  if (scanning) {
    rescanQueued = true
    return scanning
  }
  scanning = (async () => {
    try {
      const folders = useStore.getState().folders
      let added = 0
      for (const folder of folders) {
        setStatus(`Scanning ${folder.path}…`)
        const all = await allBooksIncludingExcluded()
        try {
          added += (await reconcileFolder(folder, all)).added
        } catch (e) {
          console.warn(e)
          toast(`Couldn't scan ${folder.path}`)
        }
      }
      await reconcileLooseFiles(await allBooksIncludingExcluded())
      await reloadLibrary()
      if (added) toast(`Added ${added} new item${added === 1 ? '' : 's'}`)
    } finally {
      setStatus(null)
      scanning = null
    }
    processMetadataQueue()
    if (rescanQueued) {
      rescanQueued = false
      await rescanAll()
    }
  })()
  return scanning
}

export async function addFolder(path: string) {
  const folders = useStore.getState().folders
  if (folders.some((f) => lower(f.path) === lower(path))) {
    toast('That folder is already in your library')
    return
  }
  if (folders.some((f) => isUnder(path, f.path))) {
    toast('That folder is already inside a library folder')
    return
  }
  await api().execute('INSERT INTO folders (path, added_at) VALUES (?, ?)', [path, Date.now()])
  await reloadLibrary()
  await startWatching()
  await rescanAll()
}

export async function removeFolder(id: number, forgetBooks: boolean) {
  const b = api()
  if (forgetBooks) await b.execute('DELETE FROM books WHERE folder_id = ?', [id])
  await b.execute('DELETE FROM folders WHERE id = ?', [id])
  await reloadLibrary()
  await startWatching()
}

/** Adds individual files or folders (from a picker, drag & drop or "Open with"). Returns the book ids. */
export async function addPaths(paths: string[]): Promise<string[]> {
  const b = api()
  const ids: string[] = []
  const files: string[] = []
  for (const p of paths) {
    const kind = await b.pathKind(p)
    if (kind === 'dir') await addFolder(p)
    else if (kind === 'file') files.push(p)
  }
  if (!files.length) return ids

  const all = await allBooksIncludingExcluded()
  const byPath = new Map(all.map((x) => [lower(x.path), x]))
  const folders = useStore.getState().folders
  const stats = await b.statFiles(files)
  const stmts: Stmt[] = []
  for (const s of stats) {
    if (!s) continue
    const existing = byPath.get(lower(s.path))
    if (existing) {
      ids.push(existing.id)
      if (existing.excluded) stmts.push(db.bookUpdateStatement(existing.id, { excluded: false }))
      continue
    }
    const folder = folders.find((f) => isUnder(s.path, f.path))
    const book = newBook(s, folder?.id ?? null)
    if (book) {
      stmts.push(db.insertBookStatement(book))
      ids.push(book.id)
    }
  }
  if (stmts.length) await b.batch(stmts)
  await reloadLibrary()
  processMetadataQueue()
  return ids
}

export async function relocateBook(id: string, path: string) {
  const [s] = await api().statFiles([path])
  if (!s) return toast('That file could not be read')
  const folder = useStore.getState().folders.find((f) => isUnder(s.path, f.path))
  await db.updateBook(id, { path: s.path, size: s.size, mtime: s.mtime, hash: s.hash, missing: false, folderId: folder?.id ?? null })
  await reloadLibrary()
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

let unlisten: (() => void) | null = null
let fsTimer: ReturnType<typeof setTimeout> | undefined

export async function startWatching() {
  const b = api()
  await b.watchFolders(useStore.getState().folders.map((f) => f.path))
  if (!unlisten) {
    unlisten = await b.onFsChanged(() => {
      clearTimeout(fsTimer)
      fsTimer = setTimeout(() => rescanAll(), 800)
    })
  }
}

// ---------------------------------------------------------------------------
// Metadata extraction (background, one file at a time)
// ---------------------------------------------------------------------------

let metaRunning = false

export async function processMetadataQueue() {
  if (metaRunning) return
  metaRunning = true
  try {
    for (;;) {
      const pending = Object.values(useStore.getState().books).filter((b) => !b.metaDone && !b.missing)
      if (!pending.length) break
      setStatus(`Reading metadata · ${pending.length} left`)
      try {
        await extractOne(pending[0])
      } catch (e) {
        console.warn(e)
        patchBooksLocal({ [pending[0].id]: { metaDone: true } })
      }
    }
  } finally {
    metaRunning = false
    setStatus(null)
  }
}

export async function extractOne(book: Book) {
  const patch: Partial<Book> = { metaDone: true }
  const extra: Record<string, SqlParam> = {}
  try {
    const rows = await api().select<{ edited: number; type_auto: number }>(
      'SELECT edited, type_auto FROM books WHERE id = ?',
      [book.id],
    )
    const edited = !!rows[0]?.edited
    const typeAuto = rows[0]?.type_auto !== 0
    const m = await extractMetadata(book)
    if (!edited) {
      if (m.title) patch.title = m.title
      if (m.authors?.length) patch.authors = m.authors
    }
    if (m.pages) patch.pages = m.pages
    if (m.description) patch.description = m.description
    if (m.publisher) patch.publisher = m.publisher
    if (m.language) patch.language = m.language
    if (m.year) patch.year = m.year
    if (typeAuto) patch.type = autoType(book.format, m.pages ?? null)
    if (m.cover) {
      patch.coverPath = await api().saveCover(book.id, m.cover)
      if (book.coverMode === 'auto') patch.coverMode = m.coverIsArt ? 'file' : 'generated'
    } else if (book.coverMode === 'auto') {
      patch.coverMode = 'generated'
    }
  } catch (e) {
    console.warn('metadata failed for', book.path, e)
    if (book.coverMode === 'auto') patch.coverMode = 'generated'
  }
  await db.updateBook(book.id, patch, extra)
  patchBooksLocal({ [book.id]: patch })
}

export async function refreshMetadata(ids: string[]) {
  for (const id of ids) {
    const b = useStore.getState().books[id]
    if (b) await db.updateBook(id, { metaDone: false })
  }
  patchBooksLocal(Object.fromEntries(ids.map((id) => [id, { metaDone: false }])))
  processMetadataQueue()
}

/**
 * Browser development backend: in-memory SQLite via sql.js plus demo files
 * served from /demo. Lets the whole UI (and the reading engines) run in a
 * normal browser without the Tauri shell.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Backend, Row, ScannedFile, SqlParam } from './backend'
import { md5Hex, partialMd5Bytes } from './md5'

export const DEMO_ROOT = 'C:\\Users\\you\\Documents\\Trove Demo'

interface ManifestEntry {
  file: string
  size: number
}

export async function createBrowserBackend(): Promise<Backend> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl, useOldExtensionFunctions: false })
  const db = new SQL.Database()
  db.run('PRAGMA foreign_keys=ON')

  let manifest: ManifestEntry[] = []
  try {
    manifest = await (await fetch('/demo/manifest.json')).json()
  } catch {
    manifest = []
  }
  const toPath = (file: string) => `${DEMO_ROOT}\\${file.replace(/\//g, '\\')}`
  const toUrl = (path: string) => '/demo/' + path.slice(DEMO_ROOT.length + 1).replace(/\\/g, '/')
  const covers = new Map<string, string>()

  const norm = (p: SqlParam[] = []) => p.map((v) => (typeof v === 'boolean' ? Number(v) : v))
  const describe = (e: ManifestEntry): ScannedFile => ({
    path: toPath(e.file),
    size: e.size,
    mtime: 1_700_000_000_000,
    ext: e.file.split('.').pop()!.toLowerCase(),
    hash: `demo-${e.file}`,
  })

  return {
    isDesktop: false,

    async execute(sql, params) {
      db.run(sql, norm(params))
      const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] as number
      return { rowsAffected: db.getRowsModified(), lastInsertId: id ?? 0 }
    },
    async select<T = Row>(sql: string, params?: SqlParam[]) {
      const stmt = db.prepare(sql)
      stmt.bind(norm(params))
      const out: T[] = []
      while (stmt.step()) out.push(stmt.getAsObject() as T)
      stmt.free()
      return out
    },
    async batch(statements) {
      db.run('BEGIN')
      try {
        for (const s of statements) {
          if (s.params?.length) db.run(s.sql, norm(s.params))
          else db.exec(s.sql)
        }
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
    },

    async scanFolder(root) {
      if (root !== DEMO_ROOT) return []
      return manifest.map(describe)
    },
    async statFiles(paths) {
      return paths.map((p) => {
        const e = manifest.find((m) => toPath(m.file) === p)
        return e ? describe(e) : null
      })
    },
    async pathKind(path) {
      if (path === DEMO_ROOT) return 'dir'
      return manifest.some((m) => toPath(m.file) === path) ? 'file' : 'missing'
    },
    async readFile(path) {
      const r = await fetch(toUrl(path))
      if (!r.ok) throw new Error(`Could not read ${path}`)
      return r.arrayBuffer()
    },
    async writeTextFile(path, contents) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([contents], { type: 'text/markdown' }))
      a.download = path.split(/[\\/]/).pop() || 'export.md'
      a.click()
    },

    async saveCover(id, data) {
      covers.set(id, `data:image/jpeg;base64,${data}`)
      return `mem:${id}`
    },
    async deleteCover(id) {
      covers.delete(id)
    },
    coverUrl(path) {
      return covers.get(path.replace(/^mem:/, '')) ?? ''
    },

    async watchFolders() {},
    async launchFiles() {
      return []
    },
    async onFsChanged() {
      return () => {}
    },
    async onOpenFiles() {
      return () => {}
    },
    async onFileDrop() {
      return () => {}
    },

    async partialMd5(path) {
      const r = await fetch(toUrl(path))
      return partialMd5Bytes(new Uint8Array(await r.arrayBuffer()))
    },
    async md5(text) {
      return md5Hex(new TextEncoder().encode(text))
    },
    async kosync(req) {
      // Dev only: needs a sync server that allows cross-origin requests
      const headers: Record<string, string> = { Accept: 'application/vnd.koreader.v1+json' }
      if (req.username && req.userkey) Object.assign(headers, { 'x-auth-user': req.username, 'x-auth-key': req.userkey })
      if (req.body) headers['Content-Type'] = 'application/json'
      const r = await fetch(req.server.replace(/\/+$/, '') + '/' + req.path.replace(/^\/+/, ''), {
        method: req.method,
        headers,
        body: req.body ? JSON.stringify(req.body) : undefined,
      })
      const text = await r.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {
        /* not JSON */
      }
      return { status: r.status, body }
    },

    async pickFolder() {
      return DEMO_ROOT
    },
    async pickFiles() {
      return []
    },
    async pickSavePath(name) {
      return name
    },
    async confirm(message) {
      return window.confirm(message)
    },
    async reveal(path) {
      console.info('reveal', path)
    },
    async setTitle(title) {
      document.title = title
    },
  }
}

/**
 * Platform boundary. In the desktop app this talks to the Rust side through
 * Tauri commands; in a plain browser (`npm run dev`) it uses an in-memory
 * SQLite (sql.js) and bundled demo files so the UI can be developed quickly.
 */

export type SqlParam = string | number | null | boolean
export type Row = Record<string, unknown>

export interface ScannedFile {
  path: string
  size: number
  mtime: number
  ext: string
  hash: string | null
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT'
  server: string
  path: string
  username?: string | null
  userkey?: string | null
  body?: unknown
}

export interface HttpResult {
  status: number
  body: unknown
}

export interface Backend {
  readonly isDesktop: boolean
  execute(sql: string, params?: SqlParam[]): Promise<{ rowsAffected: number; lastInsertId: number }>
  select<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>
  batch(statements: { sql: string; params?: SqlParam[] }[]): Promise<void>

  scanFolder(root: string, known: Record<string, [number, number]>): Promise<ScannedFile[]>
  statFiles(paths: string[]): Promise<(ScannedFile | null)[]>
  pathKind(path: string): Promise<'dir' | 'file' | 'missing'>
  readFile(path: string): Promise<ArrayBuffer>
  writeTextFile(path: string, contents: string): Promise<void>

  saveCover(id: string, jpegBase64: string): Promise<string>
  deleteCover(id: string): Promise<void>
  coverUrl(path: string): string

  watchFolders(folders: string[]): Promise<void>
  launchFiles(): Promise<string[]>
  onFsChanged(cb: (paths: string[]) => void): Promise<() => void>
  onOpenFiles(cb: (paths: string[]) => void): Promise<() => void>
  onFileDrop(cb: (paths: string[]) => void, hover?: (over: boolean) => void): Promise<() => void>

  /** KOReader-compatible document fingerprint */
  partialMd5(path: string): Promise<string>
  md5(text: string): Promise<string>
  /** Request to a KOReader sync server */
  kosync(req: HttpRequest): Promise<HttpResult>

  pickFolder(): Promise<string | null>
  pickFiles(): Promise<string[]>
  pickSavePath(defaultName: string, ext: string): Promise<string | null>
  confirm(message: string, title?: string): Promise<boolean>
  reveal(path: string): Promise<void>
  setTitle(title: string): Promise<void>
}

let backend: Backend | null = null

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function initBackend(): Promise<Backend> {
  if (backend) return backend
  backend = isTauri()
    ? (await import('./backend-tauri')).createTauriBackend()
    : await (await import('./backend-browser')).createBrowserBackend()
  return backend
}

export function api(): Backend {
  if (!backend) throw new Error('Backend not initialised')
  return backend
}

/**
 * KOReader progress sync (https://github.com/koreader/koreader-sync-server).
 *
 * The server stores one record per document fingerprint:
 *   { progress, percentage, device, device_id, timestamp }
 * where `progress` is a page number for paged documents (PDF, CBZ) and a
 * CREngine XPointer for reflowable ones (EPUB).
 */
import { create } from 'zustand'
import { api } from './backend'
import * as db from './db'
import type { Book } from './types'

export const DEFAULT_SERVER = 'https://sync.koreader.rocks'

export interface KoSettings {
  enabled: boolean
  server: string
  username: string | null
  userkey: string | null
  deviceId: string
  deviceName: string
}

export interface KoRecord {
  document?: string
  progress?: string
  percentage?: number
  device?: string
  device_id?: string
  /** seconds since epoch */
  timestamp?: number
}

const newDeviceId = () => crypto.randomUUID().replace(/-/g, '').toUpperCase()

export const useKoSync = create<KoSettings>(() => ({
  enabled: true,
  server: DEFAULT_SERVER,
  username: null,
  userkey: null,
  deviceId: '',
  deviceName: 'Trove',
}))

export async function loadKoSettings() {
  const saved = await db.getSetting<Partial<KoSettings>>('kosync', {})
  const s = { ...useKoSync.getState(), ...saved }
  if (!s.deviceId) {
    s.deviceId = newDeviceId()
    await db.setSetting('kosync', s)
  }
  useKoSync.setState(s)
}

export async function saveKoSettings(patch: Partial<KoSettings>) {
  useKoSync.setState(patch)
  await db.setSetting('kosync', useKoSync.getState())
}

export const isLoggedIn = () => {
  const s = useKoSync.getState()
  return !!(s.username && s.userkey)
}

/** Formats Trove can exchange positions for. */
export const koSupported = (b: Book) => b.format === 'pdf' || b.format === 'epub' || b.format === 'cbz'

export class KoSyncError extends Error {}

async function request(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, auth?: { username: string; userkey: string; server?: string }) {
  const s = useKoSync.getState()
  const res = await api().kosync({
    method,
    server: auth?.server ?? s.server ?? DEFAULT_SERVER,
    path,
    username: auth?.username ?? s.username,
    userkey: auth?.userkey ?? s.userkey,
    body,
  })
  return res
}

function message(body: unknown, fallback: string): string {
  const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined
  return typeof m === 'string' && m ? m : fallback
}

export async function login(server: string, username: string, password: string) {
  const userkey = await api().md5(password)
  const res = await request('GET', '/users/auth', undefined, { server, username, userkey })
  if (res.status === 200) {
    await saveKoSettings({ server, username, userkey })
    return
  }
  if (res.status === 401) throw new KoSyncError('Wrong username or password.')
  throw new KoSyncError(message(res.body, `The server answered ${res.status}.`))
}

export async function register(server: string, username: string, password: string) {
  const userkey = await api().md5(password)
  const res = await request('POST', '/users/create', { username, password: userkey }, { server, username, userkey })
  if (res.status === 201) {
    await saveKoSettings({ server, username, userkey })
    return
  }
  if (res.status === 402) throw new KoSyncError('That username is already taken. Try logging in instead.')
  throw new KoSyncError(message(res.body, `The server answered ${res.status}.`))
}

export async function logout() {
  await saveKoSettings({ username: null, userkey: null })
}

export async function pullProgress(digest: string): Promise<KoRecord | null> {
  const res = await request('GET', `/syncs/progress/${digest}`)
  if (res.status === 401) throw new KoSyncError('KOReader sync login expired. Log in again in Settings.')
  if (res.status !== 200) throw new KoSyncError(message(res.body, `Sync server error ${res.status}`))
  const body = res.body as KoRecord
  return body && typeof body === 'object' && body.percentage != null ? body : null
}

export async function pushProgress(digest: string, progress: string, percentage: number) {
  const s = useKoSync.getState()
  const res = await request('PUT', '/syncs/progress', {
    document: digest,
    progress,
    percentage: Math.round(percentage * 10000) / 10000,
    device: s.deviceName || 'Trove',
    device_id: s.deviceId,
  })
  if (res.status === 401) throw new KoSyncError('KOReader sync login expired. Log in again in Settings.')
  if (res.status !== 200 && res.status !== 202) throw new KoSyncError(message(res.body, `Sync server error ${res.status}`))
}

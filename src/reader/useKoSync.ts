import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { api } from '../lib/backend'
import { isLoggedIn, koSupported, pullProgress, pushProgress, useKoSync, type KoRecord } from '../lib/kosync'
import { toast } from '../lib/store'
import type { Book } from '../lib/types'
import type { EngineHandle, Relocation } from './types'

export type KoStatus = 'off' | 'syncing' | 'synced' | 'error'

const PUSH_DELAY = 15_000

const pct = (f: number) => `${Math.round(f * 100)}%`

/**
 * Keeps the open book's position in sync with a KOReader sync server:
 * pulls when the book opens (jumping ahead if another device is further along
 * and more recent), and pushes the position a few seconds after you stop
 * turning pages and again when the book closes.
 */
export function useKoSyncForBook(
  book: Book | undefined,
  engine: RefObject<EngineHandle | null>,
  ready: boolean,
  loc: Relocation | null,
  /** when this book's saved progress was last updated, captured before opening */
  localUpdatedAt: number,
) {
  const settings = useKoSync()
  const active = !!book && settings.enabled && isLoggedIn() && koSupported(book)
  const [status, setStatus] = useState<KoStatus>('off')
  const [detail, setDetail] = useState<string>('')

  const digest = useRef<string | null>(null)
  const lastPushed = useRef<string | null>(null)
  const baseline = useRef<string | null>(null)
  const lastMove = useRef(localUpdatedAt)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const initialised = useRef(false)
  const pulled = useRef(false)
  /** last known position; the engine may already be gone when the book closes */
  const latest = useRef<{ progress: string; percentage: number } | null>(null)

  const getDigest = useCallback(async () => {
    if (!digest.current) digest.current = await api().partialMd5(book!.path)
    return digest.current
  }, [book?.path])

  const push = useCallback(
    async (force = false) => {
      clearTimeout(timer.current)
      timer.current = undefined
      const pos = engine.current?.koPosition?.() ?? latest.current
      if (!pos) return
      if (!force && (pos.progress === lastPushed.current || pos.progress === baseline.current)) return
      try {
        setStatus('syncing')
        await pushProgress(await getDigest(), pos.progress, pos.percentage)
        lastPushed.current = pos.progress
        setStatus('synced')
        setDetail(`Sent ${pct(pos.percentage)} to KOReader sync`)
      } catch (e) {
        setStatus('error')
        setDetail(e instanceof Error ? e.message : String(e))
      }
    },
    [engine, getDigest],
  )

  /** Applies a remote record if it is from another device and differs from here. */
  const applyRemote = useCallback(
    async (remote: KoRecord) => {
      const cur = engine.current?.koPosition?.()
      if (!engine.current?.goToKo || remote.progress == null || remote.percentage == null) return false
      if (cur && (remote.progress === cur.progress || Math.abs(remote.percentage - cur.percentage) < 0.0005)) return false
      const exact = await engine.current.goToKo(remote.progress, remote.percentage)
      const from = remote.device ? ` from ${remote.device}` : ''
      toast(`Synced to ${pct(remote.percentage)}${from}${exact ? '' : ' (approximate)'}`)
      // don't immediately echo the same position back to the server
      setTimeout(() => (baseline.current = engine.current?.koPosition?.()?.progress ?? null), 1200)
      lastPushed.current = remote.progress
      return true
    },
    [engine],
  )

  const sync = useCallback(
    async (interactive: boolean) => {
      if (!active) {
        if (interactive) toast('Set up KOReader sync in Settings first')
        return
      }
      try {
        setStatus('syncing')
        const remote = await pullProgress(await getDigest())
        const mine = useKoSync.getState().deviceId
        if (remote && remote.device_id !== mine) {
          const remoteMs = (remote.timestamp ?? 0) * 1000
          if (remoteMs > lastMove.current) {
            const moved = await applyRemote(remote)
            setStatus('synced')
            setDetail(moved ? `Synced from ${remote.device ?? 'another device'}` : 'Already in sync')
            if (!moved && interactive) toast('Already in sync')
            return
          }
        }
        // this device is newer (or the server has nothing yet): send ours
        const pos = engine.current?.koPosition?.()
        if (pos && (pos.percentage > 0 || interactive)) await push(true)
        else setStatus('synced')
        if (interactive) toast(remote ? 'Sent this position to KOReader sync' : 'No progress on the server yet — sent this position')
      } catch (e) {
        setStatus('error')
        const msg = e instanceof Error ? e.message : String(e)
        setDetail(msg)
        if (interactive) toast(msg)
      } finally {
        pulled.current = true
      }
    },
    [active, getDigest, applyRemote, push, engine],
  )

  // pull once the book is open
  useEffect(() => {
    if (!ready || !active || initialised.current) return
    initialised.current = true
    sync(false)
  }, [ready, active, sync])

  // push after the reader settles on a new position
  useEffect(() => {
    if (!ready || !active || !loc) return
    latest.current = engine.current?.koPosition?.() ?? latest.current
    if (!pulled.current) return
    lastMove.current = Date.now()
    if (!timer.current) timer.current = setTimeout(() => push(), PUSH_DELAY)
  }, [loc, ready, active, push, engine])

  // push on close
  useEffect(
    () => () => {
      if (timer.current) push()
    },
    [push],
  )

  useEffect(() => {
    if (!active) setStatus('off')
  }, [active])

  return { active, status, detail, syncNow: () => sync(true) }
}

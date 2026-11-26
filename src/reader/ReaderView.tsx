import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NoteEditor } from '../components/AnnotationsView'
import { api } from '../lib/backend'
import * as db from '../lib/db'
import { exportBookNotes } from '../lib/exportNotes'
import { formatDuration, percent } from '../lib/selectors'
import {
  closeReader,
  removeAnnotation,
  saveProgress,
  setFinished,
  toggleStar,
  updateBooks,
  upsertAnnotation,
  useStore,
} from '../lib/store'
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor, type ReadingSession } from '../lib/types'
import { FoliateEngine } from './FoliateEngine'
import { FONT_STACKS } from './fonts'
import { PdfEngine } from './PdfEngine'
import { TextEngine } from './TextEngine'
import { useKoSyncForBook } from './useKoSync'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_PDF,
  THEMES,
  type Appearance,
  type EngineHandle,
  type PdfSettings,
  type Relocation,
  type SearchHit,
  type SelectionInfo,
  type TocEntry,
} from './types'

type Panel = 'contents' | 'bookmarks' | 'highlights' | null

function Swatches({ value, onPick }: { value?: HighlightColor; onPick: (c: HighlightColor) => void }) {
  return (
    <div className="swatches">
      {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
        <button
          key={c}
          className={`swatch ${value === c ? 'on' : ''}`}
          style={{ background: HIGHLIGHT_COLORS[c] }}
          title={c}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}

function Popover({ rect, children }: { rect: DOMRect; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: rect.left, top: rect.top - 52 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = rect.left + rect.width / 2 - w / 2
    let top = rect.top - h - 10
    if (top < 60) top = rect.bottom + 10
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
    top = Math.min(window.innerHeight - h - 8, top)
    setPos({ left, top })
  }, [rect, children])
  return (
    <div ref={ref} className="popover" style={pos} onPointerDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

/** Estimated reading speed (fraction per ms) from past sessions. */
function readingSpeed(sessions: ReadingSession[]) {
  let frac = 0
  let time = 0
  for (const s of sessions) {
    const d = s.endFraction - s.startFraction
    const t = s.endedAt - s.startedAt
    if (d <= 0 || d > 0.25 || t < 60_000) continue
    frac += d
    time += Math.min(t, 3 * 3600_000)
  }
  return frac > 0.005 && time > 120_000 ? frac / time : null
}

export function ReaderView() {
  const target = useStore((s) => s.reader)!
  const book = useStore((s) => s.books[target.bookId])
  const progress = useStore((s) => s.progress[target.bookId])
  const allAnnotations = useStore((s) => s.annotations)
  const annotations = useMemo(() => allAnnotations.filter((a) => a.bookId === target.bookId), [allAnnotations, target.bookId])
  const highlights = useMemo(() => annotations.filter((a) => a.kind === 'highlight'), [annotations])
  const bookmarks = useMemo(
    () => annotations.filter((a) => a.kind === 'bookmark').sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0)),
    [annotations],
  )

  const engine = useRef<EngineHandle>(null)
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [ready, setReady] = useState(false)
  const [loc, setLoc] = useState<Relocation | null>(null)
  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [pdfSettings, setPdfSettings] = useState<PdfSettings | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [active, setActive] = useState<{ id: string; rect: DOMRect; editing?: boolean } | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [chrome, setChrome] = useState(true)

  // search state
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchProgress, setSearchProgress] = useState<number | null>(null)
  const searchAbort = useRef<AbortController | null>(null)

  const session = useRef<{ start: number; startFraction: number; last: number; lastFraction: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const pendingProgress = useRef<Relocation | null>(null)

  // when this book's position was last saved, before this reading session (for sync conflicts)
  const [openedProgressAt] = useState(() => useStore.getState().progress[target.bookId]?.updatedAt ?? 0)
  const ko = useKoSyncForBook(book, engine, ready, loc, openedProgressAt)

  const isPdf = book?.format === 'pdf'
  const isText = book?.format === 'txt' || book?.format === 'md' || book?.format === 'html'

  // ---- load --------------------------------------------------------------
  useEffect(() => {
    if (!book) return
    let cancelled = false
    ;(async () => {
      const [a, p, sess] = await Promise.all([
        db.getSetting<Appearance>('appearance', DEFAULT_APPEARANCE),
        db.getSetting<PdfSettings>('pdf', DEFAULT_PDF),
        db.loadSessions(book.id),
      ])
      if (cancelled) return
      setAppearance({ ...DEFAULT_APPEARANCE, ...a })
      setPdfSettings({ ...DEFAULT_PDF, ...p })
      setSessions(sess)
      try {
        const bytes = await api().readFile(book.path)
        if (!cancelled) setData(bytes)
      } catch (e) {
        if (!cancelled) setError(`Couldn't read the file. It may have been moved or deleted.\n${book.path}`)
      }
      updateBooks([book.id], { openedAt: Date.now() })
      api().setTitle(`${book.title} — Trove`)
    })()
    return () => {
      cancelled = true
      api().setTitle('Trove')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.bookId])

  const flushProgress = useCallback(() => {
    const p = pendingProgress.current
    if (!p || !book) return
    pendingProgress.current = null
    saveProgress({ bookId: book.id, locator: p.locator, fraction: p.fraction, label: p.chapter, updatedAt: Date.now() })
  }, [book])

  const endSession = useCallback(() => {
    const s = session.current
    if (!s || !book) return
    session.current = null
    if (s.last - s.start >= 30_000 && s.lastFraction !== s.startFraction) {
      const rec = { bookId: book.id, startedAt: s.start, endedAt: s.last, startFraction: s.startFraction, endFraction: s.lastFraction }
      db.saveSession(rec)
      setSessions((x) => [...x, rec])
    }
  }, [book])

  // flush on close
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
      flushProgress()
      endSession()
    },
    [flushProgress, endSession],
  )

  // idle detection ends a reading session after 5 minutes without movement
  useEffect(() => {
    const t = setInterval(() => {
      const s = session.current
      if (s && Date.now() - s.last > 5 * 60_000) endSession()
    }, 30_000)
    return () => clearInterval(t)
  }, [endSession])

  const onRelocate = useCallback(
    (r: Relocation) => {
      if (!book) return
      setLoc(r)
      const now = Date.now()
      if (!session.current) session.current = { start: now, startFraction: r.fraction, last: now, lastFraction: r.fraction }
      else {
        session.current.last = now
        session.current.lastFraction = r.fraction
      }
      pendingProgress.current = r
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushProgress, 700)
      const atEnd = r.fraction >= 0.995 || (r.page != null && r.page === r.pageCount && (r.pageCount ?? 0) > 1)
      if (atEnd && !useStore.getState().books[book.id]?.finishedAt) setFinished([book.id], true)
    },
    [book, flushProgress],
  )

  const persistAppearance = (a: Appearance) => {
    setAppearance(a)
    db.setSetting('appearance', a)
  }
  const persistPdf = (p: PdfSettings) => {
    setPdfSettings(p)
    db.setSetting('pdf', p)
  }

  // ---- bookmarks ---------------------------------------------------------
  const currentBookmark = useMemo(() => {
    if (!loc) return null
    return (
      bookmarks.find((b) => {
        if (isPdf) return b.locator.split(':')[1] === String(loc.page)
        if (b.locator === loc.locator) return true
        return b.fraction != null && Math.abs(b.fraction - loc.fraction) < 0.002
      }) ?? null
    )
  }, [bookmarks, loc, isPdf])

  const toggleBookmark = () => {
    if (!loc || !book) return
    if (currentBookmark) return removeAnnotation(currentBookmark.id)
    const now = Date.now()
    upsertAnnotation({
      id: crypto.randomUUID(),
      bookId: book.id,
      kind: 'bookmark',
      locator: isPdf ? `pdf:${loc.page}:0` : loc.locator,
      text: loc.chapter ?? loc.position,
      note: null,
      color: 'yellow',
      label: loc.position,
      fraction: loc.fraction,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ---- highlights --------------------------------------------------------
  const createHighlight = (color: HighlightColor, withNote = false) => {
    if (!selection || !book) return
    const now = Date.now()
    const a: Annotation = {
      id: crypto.randomUUID(),
      bookId: book.id,
      kind: 'highlight',
      locator: selection.locator,
      text: selection.text,
      note: null,
      color,
      label: selection.chapter ?? loc?.chapter ?? null,
      fraction: selection.fraction || loc?.fraction || 0,
      createdAt: now,
      updatedAt: now,
    }
    upsertAnnotation(a)
    engine.current?.clearSelection()
    setSelection(null)
    if (withNote) setActive({ id: a.id, rect: selection.rect, editing: true })
  }

  const activeAnnotation = active ? annotations.find((a) => a.id === active.id) : null

  // ---- search ------------------------------------------------------------
  const runSearch = async (q: string) => {
    searchAbort.current?.abort()
    engine.current?.clearSearch()
    setHits([])
    if (!q.trim()) return setSearchProgress(null)
    const ctrl = new AbortController()
    searchAbort.current = ctrl
    setSearchProgress(0)
    const acc: SearchHit[] = []
    await engine.current?.search(
      q,
      (h) => {
        if (ctrl.signal.aborted) return
        acc.push(...h)
        setHits([...acc])
      },
      (p) => !ctrl.signal.aborted && setSearchProgress(p),
      ctrl.signal,
    )
    if (!ctrl.signal.aborted) setSearchProgress(null)
  }

  const go = (locator: string) => {
    engine.current?.goTo(locator)
    setSelection(null)
  }

  // jump to a target requested from outside (e.g. Highlights view) after load
  useEffect(() => {
    if (ready && target.locator && target.locator !== '__start__' && target.locator !== progress?.locator) engine.current?.goTo(target.locator)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // ---- keyboard ----------------------------------------------------------
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t?.closest?.('input, textarea')
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearch(true)
        setTimeout(() => document.querySelector<HTMLInputElement>('.search-panel input')?.focus(), 0)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleBookmark()
        return
      }
      if (ctrl && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setPanel((p) => (p ? null : 'contents'))
        return
      }
      if (ctrl && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault()
        const dir = e.key === '-' ? -1 : 1
        if (isPdf && pdfSettings) {
          const cur = typeof pdfSettings.zoom === 'number' ? pdfSettings.zoom : 1
          persistPdf({ ...pdfSettings, zoom: Math.min(4, Math.max(0.3, +(cur + dir * 0.15).toFixed(2))) })
        } else if (appearance) persistAppearance({ ...appearance, fontSize: Math.min(36, Math.max(12, appearance.fontSize + dir)) })
        return
      }
      if (typing) return
      if (e.key === 'Escape') {
        if (selection || active) {
          setSelection(null)
          setActive(null)
        } else if (showAppearance) setShowAppearance(false)
        else if (showSearch) setShowSearch(false)
        else if (panel) setPanel(null)
        else closeReader()
        return
      }
      if (ctrl) return
      if (['ArrowRight', 'PageDown', ' '].includes(e.key) && !(isPdf || isText) ) {
        e.preventDefault()
        engine.current?.next()
      } else if (['ArrowLeft', 'PageUp'].includes(e.key) && !(isPdf || isText)) {
        e.preventDefault()
        engine.current?.prev()
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (isPdf || isText)) {
        e.preventDefault()
        if (e.key === 'ArrowRight') engine.current?.next()
        else engine.current?.prev()
      } else if (e.key === 'Home') engine.current?.goToFraction(0)
      else if (e.key === 'End') engine.current?.goToFraction(0.9999)
      else if (e.key.toLowerCase() === 'f' && !e.shiftKey) setChrome((c) => !c)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, active, showAppearance, showSearch, panel, appearance, pdfSettings, isPdf, isText, loc, currentBookmark],
  )
  useEffect(() => {
    document.body.classList.toggle('focus-mode', !chrome)
    return () => document.body.classList.remove('focus-mode')
  }, [chrome])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (!book) return null

  const theme = THEMES[appearance?.theme ?? 'dark']
  const isLightTheme = appearance?.theme === 'sepia' || appearance?.theme === 'light'
  const speed = readingSpeed(sessions)
  const rawFraction = loc?.fraction ?? progress?.fraction ?? 0
  const fraction = Number.isFinite(rawFraction) ? rawFraction : 0
  const timeLeft = speed ? formatDuration((1 - fraction) / speed) : null
  const engineProps =
    data && appearance && pdfSettings
      ? {
          book,
          data,
          initialLocator: target.locator === '__start__' ? '__start__' : (target.locator ?? progress?.locator ?? null),
          appearance,
          pdf: pdfSettings,
          highlights,
          onReady: (t: TocEntry[]) => {
            setToc(t)
            setReady(true)
          },
          onRelocate,
          onSelection: (s: SelectionInfo | null) => {
            setSelection(s)
            if (s) setActive(null)
          },
          onHighlightClick: (id: string, rect: DOMRect) => setActive({ id, rect }),
          onKey,
          onError: setError,
        }
      : null

  const currentTocIndex = (() => {
    if (!loc?.chapter) return -1
    for (let i = toc.length - 1; i >= 0; i--) if (toc[i].label.trim() === loc.chapter) return i
    return -1
  })()

  return (
    <div
      className={`reader ${isLightTheme ? 'light' : 'dark'} ${chrome ? '' : 'no-chrome'}`}
      style={{ ['--r-bg' as string]: isPdf ? '#2a2724' : theme.bg, ['--r-fg' as string]: theme.fg, ['--r-muted' as string]: theme.muted }}
    >
      <div className="reader-bar">
        <button className="r-btn" onClick={closeReader} title="Back to library (Esc)">
          ‹ Library
        </button>
        <button className={`r-btn ${panel ? 'on' : ''}`} onClick={() => setPanel(panel ? null : 'contents')} title="Contents & notes (Ctrl+B)">
          ☰
        </button>
        <div className="r-title">
          <span className="r-book">{book.title}</span>
          {book.authors.length > 0 && <span className="r-author"> · {book.authors.join(', ')}</span>}
        </div>
        {isPdf && pdfSettings && (
          <div className="r-group">
            <button
              className="r-btn"
              title="Zoom out (Ctrl -)"
              onClick={() => {
                const cur = typeof pdfSettings.zoom === 'number' ? pdfSettings.zoom : 1
                persistPdf({ ...pdfSettings, zoom: Math.max(0.3, +(cur - 0.15).toFixed(2)) })
              }}
            >
              −
            </button>
            <span className="r-zoom">{typeof pdfSettings.zoom === 'number' ? `${Math.round(pdfSettings.zoom * 100)}%` : pdfSettings.zoom === 'fit-width' ? 'Width' : 'Page'}</span>
            <button
              className="r-btn"
              title="Zoom in (Ctrl +)"
              onClick={() => {
                const cur = typeof pdfSettings.zoom === 'number' ? pdfSettings.zoom : 1
                persistPdf({ ...pdfSettings, zoom: Math.min(4, +(cur + 0.15).toFixed(2)) })
              }}
            >
              +
            </button>
            <button className={`r-btn ${pdfSettings.zoom === 'fit-width' ? 'on' : ''}`} onClick={() => persistPdf({ ...pdfSettings, zoom: 'fit-width' })} title="Fit width">
              ↔
            </button>
            <button className={`r-btn ${pdfSettings.zoom === 'fit-page' ? 'on' : ''}`} onClick={() => persistPdf({ ...pdfSettings, zoom: 'fit-page' })} title="Fit page">
              ⤢
            </button>
            <button className={`r-btn ${pdfSettings.spread ? 'on' : ''}`} onClick={() => persistPdf({ ...pdfSettings, spread: !pdfSettings.spread })} title="Two pages side by side">
              ▯▯
            </button>
            <button className={`r-btn ${pdfSettings.darkPages ? 'on' : ''}`} onClick={() => persistPdf({ ...pdfSettings, darkPages: !pdfSettings.darkPages })} title="Dark pages">
              ◐
            </button>
          </div>
        )}
        {!isPdf && (
          <button className={`r-btn ${showAppearance ? 'on' : ''}`} onClick={() => setShowAppearance(!showAppearance)} title="Appearance">
            Aa
          </button>
        )}
        <button className={`r-btn ${showSearch ? 'on' : ''}`} onClick={() => setShowSearch(!showSearch)} title="Search in book (Ctrl+F)">
          ⌕
        </button>
        {ko.active && (
          <button
            className={`r-btn sync-btn ${ko.status}`}
            onClick={() => ko.syncNow()}
            title={`KOReader sync${ko.detail ? ` — ${ko.detail}` : ''}\nClick to sync now`}
          >
            ⇅
          </button>
        )}
        <button className={`r-btn ${currentBookmark ? 'on bm' : ''}`} onClick={toggleBookmark} title="Bookmark this page (Ctrl+D)">
          {currentBookmark ? '★' : '☆'}
          <span className="sr-only">Bookmark</span>
        </button>
        <button className={`r-btn ${book.starred ? 'on' : ''}`} onClick={() => toggleStar([book.id])} title="Star book">
          {book.starred ? '♥' : '♡'}
        </button>
      </div>

      <div className="reader-body">
        {panel && (
          <aside className="r-panel left">
            <div className="r-tabs">
              {(['contents', 'bookmarks', 'highlights'] as const).map((p) => (
                <button key={p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>
                  {p === 'contents' ? 'Contents' : p === 'bookmarks' ? `Bookmarks ${bookmarks.length || ''}` : `Highlights ${highlights.length || ''}`}
                </button>
              ))}
            </div>
            <div className="r-panel-scroll">
              {panel === 'contents' &&
                (toc.length ? (
                  toc.map((t, i) => (
                    <div
                      key={i}
                      className={`toc-item ${i === currentTocIndex ? 'current' : ''}`}
                      style={{ paddingLeft: 14 + t.depth * 14 }}
                      onClick={() => go(t.target)}
                    >
                      {t.label}
                    </div>
                  ))
                ) : (
                  <div className="muted pad">This file has no table of contents.</div>
                ))}
              {panel === 'bookmarks' &&
                (bookmarks.length ? (
                  bookmarks.map((b) => (
                    <div key={b.id} className="toc-item note-row" onClick={() => go(b.locator)}>
                      <span>{b.text || b.label}</span>
                      <span className="muted small">{b.label}</span>
                      <button className="x" onClick={(e) => (e.stopPropagation(), removeAnnotation(b.id))} title="Remove">
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="muted pad">No bookmarks yet. Press Ctrl+D to bookmark the current page.</div>
                ))}
              {panel === 'highlights' && (
                <>
                  {highlights.length > 0 && (
                    <button className="link-btn small pad" onClick={() => exportBookNotes(book.id)}>
                      Export as Markdown
                    </button>
                  )}
                  {[...highlights]
                    .sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
                    .map((h) => (
                      <div key={h.id} className="hl-row" onClick={() => go(h.locator)}>
                        <blockquote style={{ borderColor: HIGHLIGHT_COLORS[h.color] }}>{h.text}</blockquote>
                        {h.note && <div className="note-text">{h.note}</div>}
                        <div className="muted small">{h.label}</div>
                      </div>
                    ))}
                  {!highlights.length && <div className="muted pad">Select text to highlight it.</div>}
                </>
              )}
            </div>
          </aside>
        )}

        <div className="r-stage" onPointerDown={() => active && !active.editing && setActive(null)}>
          {error ? (
            <div className="r-error">
              <p>{error}</p>
              <button className="btn" onClick={closeReader}>
                Back to library
              </button>
            </div>
          ) : !engineProps ? (
            <div className="r-loading">Opening…</div>
          ) : isPdf ? (
            <PdfEngine ref={engine} {...engineProps} />
          ) : isText ? (
            <TextEngine ref={engine} {...engineProps} />
          ) : (
            <FoliateEngine ref={engine} {...engineProps} />
          )}
          {!ready && engineProps && !error && <div className="r-loading overlay-loading">Opening…</div>}
          {!isPdf && !isText && ready && appearance?.flow === 'paginated' && (
            <>
              <button className="page-zone left" onClick={() => engine.current?.prev()} aria-label="Previous page" />
              <button className="page-zone right" onClick={() => engine.current?.next()} aria-label="Next page" />
            </>
          )}
        </div>

        {showSearch && (
          <aside className="r-panel right search-panel">
            <div className="search-head">
              <input
                className="input"
                autoFocus
                placeholder="Search in this book"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(query)
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setShowSearch(false)
                  }
                }}
              />
              <button className="r-btn" onClick={() => (setShowSearch(false), engine.current?.clearSearch(), searchAbort.current?.abort())}>
                ×
              </button>
            </div>
            <div className="muted small pad">
              {searchProgress != null
                ? `Searching… ${Math.round(searchProgress * 100)}%`
                : hits.length
                  ? `${hits.length}${hits.length >= 200 ? '+' : ''} results`
                  : query && 'Press Enter to search'}
            </div>
            <div className="r-panel-scroll">
              {hits.map((h, i) => (
                <div key={i} className="hit" onClick={() => go(h.locator)}>
                  {h.label && (i === 0 || hits[i - 1].label !== h.label) && <div className="hit-label">{h.label}</div>}
                  <span className="muted">…{h.pre}</span>
                  <mark>{h.match}</mark>
                  <span className="muted">{h.post}…</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {showAppearance && appearance && (
          <div className="appearance" onPointerDown={(e) => e.stopPropagation()}>
            <div className="ap-row themes">
              {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((k) => (
                <button
                  key={k}
                  className={`theme-chip ${appearance.theme === k ? 'on' : ''}`}
                  style={{ background: THEMES[k].bg, color: THEMES[k].fg }}
                  onClick={() => persistAppearance({ ...appearance, theme: k })}
                >
                  {THEMES[k].label}
                </button>
              ))}
            </div>
            <div className="ap-row">
              {(Object.keys(FONT_STACKS) as (keyof typeof FONT_STACKS)[]).map((f) => (
                <button
                  key={f}
                  className={`seg ${appearance.font === f ? 'on' : ''}`}
                  style={{ fontFamily: FONT_STACKS[f].stack ?? undefined }}
                  onClick={() => persistAppearance({ ...appearance, font: f })}
                >
                  {FONT_STACKS[f].label}
                </button>
              ))}
            </div>
            <Stepper label="Text size" value={`${appearance.fontSize}px`} onDec={() => persistAppearance({ ...appearance, fontSize: Math.max(12, appearance.fontSize - 1) })} onInc={() => persistAppearance({ ...appearance, fontSize: Math.min(36, appearance.fontSize + 1) })} />
            <Stepper label="Line spacing" value={appearance.lineHeight.toFixed(1)} onDec={() => persistAppearance({ ...appearance, lineHeight: Math.max(1.1, +(appearance.lineHeight - 0.1).toFixed(1)) })} onInc={() => persistAppearance({ ...appearance, lineHeight: Math.min(2.4, +(appearance.lineHeight + 0.1).toFixed(1)) })} />
            <Stepper label="Line width" value={`${appearance.width}px`} onDec={() => persistAppearance({ ...appearance, width: Math.max(420, appearance.width - 40) })} onInc={() => persistAppearance({ ...appearance, width: Math.min(1200, appearance.width + 40) })} />
            {!isText && (
              <>
                <div className="ap-row">
                  <button className={`seg ${appearance.flow === 'paginated' ? 'on' : ''}`} onClick={() => persistAppearance({ ...appearance, flow: 'paginated' })}>
                    Pages
                  </button>
                  <button className={`seg ${appearance.flow === 'scrolled' ? 'on' : ''}`} onClick={() => persistAppearance({ ...appearance, flow: 'scrolled' })}>
                    Scroll
                  </button>
                </div>
                {appearance.flow === 'paginated' && (
                  <div className="ap-row">
                    <button className={`seg ${appearance.columns === 1 ? 'on' : ''}`} onClick={() => persistAppearance({ ...appearance, columns: 1 })}>
                      One column
                    </button>
                    <button className={`seg ${appearance.columns === 2 ? 'on' : ''}`} onClick={() => persistAppearance({ ...appearance, columns: 2 })}>
                      Two when wide
                    </button>
                  </div>
                )}
              </>
            )}
            <label className="ap-check">
              <input type="checkbox" checked={appearance.justify} onChange={(e) => persistAppearance({ ...appearance, justify: e.target.checked })} />
              Justify text
            </label>
          </div>
        )}
      </div>

      <div className="reader-foot">
        <span className="f-chapter">{loc?.chapter ?? ''}</span>
        <input
          className="f-slider"
          type="range"
          min={0}
          max={1}
          step={0.0005}
          value={fraction}
          onChange={(e) => engine.current?.goToFraction(Number(e.target.value))}
          style={{ ['--p' as string]: `${fraction * 100}%` }}
          aria-label="Reading progress"
        />
        <span className="f-pos">
          {loc?.position && !isText ? `${loc.position} · ` : ''}
          {percent(fraction)}
          {timeLeft && fraction < 0.995 ? ` · ~${timeLeft} left` : ''}
        </span>
      </div>

      {selection && (
        <Popover rect={selection.rect}>
          <Swatches onPick={(c) => createHighlight(c)} />
          <span className="pop-sep" />
          <button className="pop-btn" onClick={() => createHighlight('yellow', true)}>
            Note
          </button>
          <button
            className="pop-btn"
            onClick={() => {
              navigator.clipboard.writeText(selection.text)
              setSelection(null)
            }}
          >
            Copy
          </button>
          <button
            className="pop-btn"
            onClick={() => {
              setShowSearch(true)
              setQuery(selection.text.slice(0, 80))
              runSearch(selection.text.slice(0, 80))
              setSelection(null)
            }}
          >
            Search
          </button>
        </Popover>
      )}

      {active && activeAnnotation && (
        <Popover rect={active.rect}>
          {active.editing ? (
            <NoteEditor annotation={activeAnnotation} onDone={() => setActive(null)} />
          ) : (
            <div className="hl-pop">
              <div className="hl-pop-row">
                <Swatches value={activeAnnotation.color} onPick={(c) => upsertAnnotation({ ...activeAnnotation, color: c, updatedAt: Date.now() })} />
                <span className="pop-sep" />
                <button className="pop-btn" onClick={() => setActive({ ...active, editing: true })}>
                  {activeAnnotation.note ? 'Edit note' : 'Note'}
                </button>
                <button className="pop-btn" onClick={() => navigator.clipboard.writeText(activeAnnotation.text ?? '')}>
                  Copy
                </button>
                <button
                  className="pop-btn danger"
                  onClick={() => {
                    removeAnnotation(activeAnnotation.id)
                    setActive(null)
                  }}
                >
                  Delete
                </button>
              </div>
              {activeAnnotation.note && <div className="note-text">{activeAnnotation.note}</div>}
            </div>
          )}
        </Popover>
      )}
    </div>
  )
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="ap-row stepper">
      <span className="ap-label">{label}</span>
      <button className="seg" onClick={onDec}>
        −
      </button>
      <span className="ap-value">{value}</span>
      <button className="seg" onClick={onInc}>
        +
      </button>
    </div>
  )
}

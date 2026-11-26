import { useEffect, useMemo } from 'react'
import { api } from '../lib/backend'
import { addPaths } from '../lib/library'
import {
  booksForView,
  defaultGroup,
  fractionOf,
  groupBooks,
  percent,
  relativeDate,
  sortBooks,
  typeCounts,
  viewTitle,
} from '../lib/selectors'
import { excludeBooks, goBack, goForward, navigate, openBook, setPrefs, toggleStar, useStore } from '../lib/store'
import { BOOK_TYPES, type Book, type GroupKey, type SortKey } from '../lib/types'
import { AnnotationsView } from './AnnotationsView'
import { BookCard, handleSelectClick, onBookContextMenu } from './BookCard'
import { Cover } from './Cover'
import { beginPotentialDrag } from './drag'
import { showMenuAt } from './menu'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'added', label: 'Date added' },
  { key: 'opened', label: 'Last opened' },
  { key: 'progress', label: 'Progress' },
]
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'shelf', label: 'Shelf' },
  { key: 'author', label: 'Author' },
  { key: 'type', label: 'Type' },
  { key: 'none', label: 'None' },
]

function ListView({ books, ordered }: { books: Book[]; ordered: string[] }) {
  const state = useStore()
  return (
    <div className="list" role="table">
      <div className="list-row list-head" role="row">
        <span />
        <span>Title</span>
        <span>Author</span>
        <span>Type</span>
        <span>Progress</span>
        <span>Opened</span>
      </div>
      {books.map((b) => {
        const f = fractionOf(state, b)
        const sel = state.selection.includes(b.id)
        return (
          <div
            key={b.id}
            role="row"
            className={`list-row ${sel ? 'selected' : ''} ${b.missing ? 'missing' : ''}`}
            onPointerDown={(e) => beginPotentialDrag(e, b.id)}
            onClick={(e) => {
              if (handleSelectClick(e, b.id, ordered)) return
              useStore.setState({ selection: [b.id] })
            }}
            onDoubleClick={() => !b.missing && openBook(b.id)}
            onContextMenu={(e) => onBookContextMenu(e, b.id)}
          >
            <span className="list-thumb">
              <Cover book={b} />
            </span>
            <span className="list-title">
              {b.starred && <span className="star-inline">★ </span>}
              {b.title}
              {b.missing && <em className="muted"> · missing</em>}
            </span>
            <span className="muted">{b.authors.join(', ')}</span>
            <span className="muted">{BOOK_TYPES.find((t) => t.key === b.type)?.singular}</span>
            <span>
              {f > 0 &&
                (f >= 1 ? (
                  <span className="muted">Finished</span>
                ) : (
                  <span className="list-progress">
                    <span className="bar">
                      <i style={{ width: `${f * 100}%` }} />
                    </span>
                    {percent(f)}
                  </span>
                ))}
            </span>
            <span className="muted">{b.openedAt ? relativeDate(b.openedAt) : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function Welcome() {
  const isDesktop = api().isDesktop
  return (
    <div className="welcome">
      <h2>Your library is empty</h2>
      <p>
        Add a folder and Trove will index every PDF, EPUB, MOBI, AZW3, FB2, CBZ, Markdown and text file inside it. Files stay
        where they are. Trove reads them in place and watches the folder for changes.
      </p>
      <div className="welcome-actions">
        <button
          className="btn primary"
          onClick={async () => {
            const p = await api().pickFolder()
            if (p) addPaths([p])
          }}
        >
          {isDesktop ? 'Add a folder…' : 'Load demo library'}
        </button>
        {isDesktop && (
          <button
            className="btn"
            onClick={async () => {
              const p = await api().pickFiles()
              if (p.length) addPaths(p)
            }}
          >
            Add files…
          </button>
        )}
      </div>
      {isDesktop && <p className="muted small">You can also drag files or folders from Explorer onto this window.</p>}
    </div>
  )
}

export function LibraryView() {
  const state = useStore()
  const { nav, typeFilter, layout, coverSize, sort, group, back, forward, folders } = state

  const base = useMemo(() => booksForView(state, nav), [state.books, state.links, state.progress, state.shelves, nav])
  const counts = useMemo(() => typeCounts(base), [base])
  const filtered = typeFilter === 'all' ? base : base.filter((b) => b.type === typeFilter)
  const sorted = useMemo(
    () => (nav.kind === 'recent' ? filtered : sortBooks(filtered, sort, state)),
    [filtered, sort, nav.kind, state.progress],
  )
  const effectiveGroup = group === 'default' ? defaultGroup(nav) : group
  const groups = useMemo(
    () => groupBooks(sorted, layout === 'list' && effectiveGroup === 'shelf' ? 'none' : effectiveGroup, state, nav),
    [sorted, effectiveGroup, layout, state.shelves, state.links, nav],
  )
  const ordered = useMemo(() => groups.flatMap((g) => g.books.map((b) => b.id)), [groups])

  // Library keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      if (useStore.getState().paletteOpen || useStore.getState().reader) return
      const sel = useStore.getState().selection
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        useStore.setState({ selection: Array.from(new Set(ordered)) })
      } else if (e.key === 'Escape') useStore.setState({ selection: [] })
      else if (e.key === 'Enter' && sel.length === 1) openBook(sel[0])
      else if (e.key === 'F2' && sel.length === 1) useStore.setState({ editBookId: sel[0] })
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && sel.length) toggleStar(sel)
      else if (e.key === 'Delete' && sel.length) {
        api()
          .confirm(`Remove ${sel.length} item${sel.length > 1 ? 's' : ''} from Trove? Files on disk are not deleted.`)
          .then((ok) => {
            if (ok) excludeBooks(sel)
          })
      } else if (e.altKey && e.key === 'ArrowLeft') goBack()
      else if (e.altKey && e.key === 'ArrowRight') goForward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ordered])

  const isNotes = nav.kind === 'bookmarks' || nav.kind === 'highlights'
  const tabs = BOOK_TYPES.filter((t) => counts[t.key])
  const empty = !Object.keys(state.books).length && !folders.length

  return (
    <main className="main" onClick={(e) => e.target === e.currentTarget && useStore.setState({ selection: [] })}>
      <div className="topbar">
        <button className="icon-btn" disabled={!back.length} onClick={goBack} title="Back (Alt+←)">
          ‹
        </button>
        <button className="icon-btn" disabled={!forward.length} onClick={goForward} title="Forward (Alt+→)">
          ›
        </button>
      </div>
      <header className="header">
        <h1>{viewTitle(state, nav)}</h1>
        {!isNotes && (
          <div className="toolbar">
            {layout === 'shelf' && (
              <label className="size-slider" title="Cover size">
                <span className="size-icon sm" />
                <input
                  type="range"
                  min={100}
                  max={240}
                  value={coverSize}
                  onChange={(e) => setPrefs({ coverSize: Number(e.target.value) })}
                />
                <span className="size-icon lg" />
              </label>
            )}
            <button
              className="tool-btn"
              onClick={(e) =>
                showMenuAt(e.currentTarget, [
                  ...SORTS.map((s) => ({ label: `Sort by ${s.label}`, checked: sort === s.key, onClick: () => setPrefs({ sort: s.key }) })),
                  { separator: true },
                  ...GROUPS.map((g) => ({
                    label: `Group by ${g.label}`,
                    checked: effectiveGroup === g.key,
                    onClick: () => setPrefs({ group: g.key }),
                  })),
                ])
              }
              title="Sort and group"
            >
              ⇅
            </button>
            <button className={`tool-btn ${layout === 'shelf' ? 'on' : ''}`} onClick={() => setPrefs({ layout: 'shelf' })} title="Shelf view">
              <svg viewBox="0 0 20 20" width="18" height="18">
                <rect x="3" y="4" width="3" height="11" fill="currentColor" />
                <rect x="7.5" y="3" width="3" height="12" fill="currentColor" />
                <rect x="12" y="5" width="3.4" height="10" fill="currentColor" transform="rotate(-12 13.7 10)" />
                <rect x="2" y="16" width="16" height="1.4" fill="currentColor" />
              </svg>
            </button>
            <button className={`tool-btn ${layout === 'list' ? 'on' : ''}`} onClick={() => setPrefs({ layout: 'list' })} title="List view">
              ☰
            </button>
            <button className="search-btn" onClick={() => useStore.setState({ paletteOpen: true })}>
              ⌕ <span>Ctrl K</span>
            </button>
          </div>
        )}
      </header>

      {isNotes ? (
        <AnnotationsView kind={nav.kind === 'bookmarks' ? 'bookmark' : 'highlight'} />
      ) : empty ? (
        <Welcome />
      ) : (
        <>
          <nav className="tabs">
            <button className={typeFilter === 'all' ? 'on' : ''} onClick={() => useStore.setState({ typeFilter: 'all' })}>
              All<sup>{base.length}</sup>
            </button>
            {tabs.map((t) => (
              <button key={t.key} className={typeFilter === t.key ? 'on' : ''} onClick={() => useStore.setState({ typeFilter: t.key })}>
                {t.label}
                <sup>{counts[t.key]}</sup>
              </button>
            ))}
          </nav>

          {!sorted.length && <div className="empty-note">{emptyMessage(nav.kind)}</div>}

          <div className="groups" style={{ ['--cover-w' as string]: `${coverSize}px` }}>
            {groups.map((g) => (
              <section key={g.key} className="group">
                {g.title.length > 0 && (groups.length > 1 || effectiveGroup !== 'none') && (
                  <h2 className="group-title">
                    {g.title.map((t, i) => (
                      <span key={i}>
                        {i > 0 && <span className="crumb-sep">›</span>}
                        {g.shelfIds?.[i] != null ? (
                          <a onClick={() => navigate({ kind: 'shelf', id: g.shelfIds![i] })}>{t}</a>
                        ) : (
                          t
                        )}
                      </span>
                    ))}
                    <sup>{g.books.length}</sup>
                  </h2>
                )}
                {layout === 'shelf' ? (
                  <div className="shelf">
                    {g.books.map((b) => (
                      <BookCard key={b.id} book={b} ordered={ordered} />
                    ))}
                  </div>
                ) : (
                  <ListView books={g.books} ordered={ordered} />
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

function emptyMessage(kind: string) {
  switch (kind) {
    case 'inbox':
      return 'Inbox zero. Everything has a shelf.'
    case 'reading':
      return 'Nothing in progress. Open something from your library to start.'
    case 'recent':
      return 'Books you open will show up here.'
    case 'starred':
      return 'Star books (right-click › Star, or press S) to collect them here.'
    case 'finished':
      return 'Books you finish will collect here.'
    case 'shelf':
      return 'This shelf is empty. Drag books onto it in the sidebar, or right-click a book › Shelves.'
    default:
      return 'Nothing here yet.'
  }
}

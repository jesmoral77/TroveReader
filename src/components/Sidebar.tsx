import { useMemo, type ReactNode } from 'react'
import { api } from '../lib/backend'
import { addPaths } from '../lib/library'
import { authorCounts, booksForView, childrenOf, descendantIds } from '../lib/selectors'
import { deleteShelf, navigate, setPrefs, toggleExpanded, useStore } from '../lib/store'
import type { NavView, Shelf } from '../lib/types'
import { showMenu, showMenuAt } from './menu'

const isActive = (a: NavView, b: NavView) => JSON.stringify(a) === JSON.stringify(b)

function Row({
  view,
  label,
  count,
  depth = 0,
  expandable,
  expanded,
  onToggle,
  dropShelf,
  onContextMenu,
  icon,
}: {
  view: NavView
  label: ReactNode
  count?: number
  depth?: number
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  dropShelf?: number
  onContextMenu?: (e: React.MouseEvent) => void
  icon?: ReactNode
}) {
  const nav = useStore((s) => s.nav)
  const reader = useStore((s) => s.reader)
  const active = !reader && isActive(nav, view)
  return (
    <div
      className={`side-row ${active ? 'active' : ''}`}
      style={{ paddingLeft: 14 + depth * 18 }}
      onClick={() => navigate(view)}
      onContextMenu={onContextMenu}
      data-drop-shelf={dropShelf}
      role="treeitem"
      aria-selected={active}
      aria-expanded={expandable ? expanded : undefined}
    >
      <span
        className={`side-caret ${expandable ? '' : 'hidden'} ${expanded ? 'open' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.()
        }}
      >
        ›
      </span>
      {icon && <span className="side-icon">{icon}</span>}
      <span className="side-label">{label}</span>
      {count != null && count > 0 && <span className="side-count">{count}</span>}
    </div>
  )
}

function ShelfTree({ shelf, depth, counts }: { shelf: Shelf; depth: number; counts: Map<number, number> }) {
  const shelves = useStore((s) => s.shelves)
  const expanded = useStore((s) => s.expanded)
  const kids = childrenOf(shelves, shelf.id)
  const open = expanded.includes(shelf.id)

  const menu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: 'New shelf inside…', onClick: () => useStore.setState({ shelfDialog: { mode: 'create', parentId: shelf.id } }) },
      { label: 'Rename…', onClick: () => useStore.setState({ shelfDialog: { mode: 'rename', id: shelf.id } }) },
      { separator: true },
      {
        label: 'Delete shelf',
        danger: true,
        onClick: async () => {
          const n = kids.length ? ' and everything inside it' : ''
          if (await api().confirm(`Delete the shelf “${shelf.name}”${n}? Books stay in your library.`)) deleteShelf(shelf.id)
        },
      },
    ])

  return (
    <>
      <Row
        view={{ kind: 'shelf', id: shelf.id }}
        label={shelf.name}
        count={counts.get(shelf.id)}
        depth={depth}
        expandable={kids.length > 0}
        expanded={open}
        onToggle={() => toggleExpanded(shelf.id)}
        dropShelf={shelf.id}
        onContextMenu={menu}
      />
      {open && kids.map((k) => <ShelfTree key={k.id} shelf={k} depth={depth + 1} counts={counts} />)}
    </>
  )
}

export function Sidebar() {
  const state = useStore()
  const { shelves, books, links, annotations, authorsExpanded, sidebarWidth } = state

  const counts = useMemo(() => {
    const m = new Map<number, number>()
    const bookList = Object.values(books)
    for (const s of shelves) {
      const ids = descendantIds(shelves, s.id)
      m.set(s.id, bookList.filter((b) => links[b.id]?.some((x) => ids.has(x))).length)
    }
    return m
  }, [shelves, books, links])

  const n = (view: NavView) => booksForView(state, view).length
  const authors = useMemo(() => authorCounts(books), [books])
  const roots = childrenOf(shelves, null)
  const missing = n({ kind: 'missing' })
  const highlights = annotations.filter((a) => a.kind === 'highlight' && books[a.bookId]).length
  const bookmarks = annotations.filter((a) => a.kind === 'bookmark' && books[a.bookId]).length

  const addMenu = (e: React.MouseEvent<HTMLButtonElement>) =>
    showMenuAt(e.currentTarget, [
      { label: 'New shelf group…', onClick: () => useStore.setState({ shelfDialog: { mode: 'create', parentId: null } }) },
      ...roots.map((r) => ({
        label: `New shelf in ${r.name}…`,
        onClick: () => useStore.setState({ shelfDialog: { mode: 'create', parentId: r.id } }),
      })),
      { separator: true },
      {
        label: 'Add folder to library…',
        onClick: async () => {
          const p = await api().pickFolder()
          if (p) addPaths([p])
        },
      },
      {
        label: 'Add files…',
        onClick: async () => {
          const p = await api().pickFiles()
          if (p.length) addPaths(p)
        },
      },
    ])

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX
    const startW = sidebarWidth
    const move = (ev: PointerEvent) => setPrefs({ sidebarWidth: Math.min(480, Math.max(220, startW + ev.clientX - startX)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }} role="tree">
      <div className="brand">Trove</div>
      <div className="side-scroll">
        <Row view={{ kind: 'inbox' }} label="Inbox" count={n({ kind: 'inbox' })} />
        <Row view={{ kind: 'all' }} label="All Books" count={Object.keys(books).length} />
        <Row view={{ kind: 'reading' }} label="Currently Reading" count={n({ kind: 'reading' })} />
        <Row view={{ kind: 'recent' }} label="Recent" />
        <Row view={{ kind: 'starred' }} label="Starred" count={n({ kind: 'starred' })} />
        <Row view={{ kind: 'finished' }} label="Finished" count={n({ kind: 'finished' })} />
        {missing > 0 && <Row view={{ kind: 'missing' }} label="Missing Files" count={missing} />}

        <div className="side-heading">Notes</div>
        <Row view={{ kind: 'bookmarks' }} label="Bookmarks" count={bookmarks} />
        <Row view={{ kind: 'highlights' }} label="Highlights" count={highlights} />

        <div className="side-heading">
          Shelves
          <button className="side-add" title="New shelf or add files" onClick={addMenu}>
            +
          </button>
        </div>
        {roots.map((r) => (
          <ShelfTree key={r.id} shelf={r} depth={0} counts={counts} />
        ))}
        <Row
          view={{ kind: 'authors' }}
          label="Authors"
          count={authors.length}
          expandable={authors.length > 0}
          expanded={authorsExpanded}
          onToggle={() => setPrefs({ authorsExpanded: !authorsExpanded })}
        />
        {authorsExpanded &&
          authors.map(([name, c]) => <Row key={name} view={{ kind: 'author', name }} label={name} count={c} depth={1} />)}
      </div>
      <div className="side-footer">
        <button className="link-btn" onClick={() => useStore.setState({ settingsOpen: true })}>
          Settings · Sync
        </button>
        {state.status && <div className="side-status">{state.status}</div>}
      </div>
      <div className="side-resize" onPointerDown={startResize} />
    </aside>
  )
}

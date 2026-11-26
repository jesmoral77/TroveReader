import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/backend'
import { addPaths, rescanAll } from '../lib/library'
import { authorCounts, flattenShelves, shelfPath } from '../lib/selectors'
import { navigate, openBook, useStore } from '../lib/store'
import { Cover } from './Cover'

interface Item {
  key: string
  section: string
  label: string
  detail?: string
  book?: string
  run: () => void
}

function score(text: string, q: string) {
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(` ${q}`)) return 2.5
  if (t.includes(q)) return 2
  // subsequence match
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 1 : 0
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const state = useStore()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
    }
  }, [open])

  const items = useMemo(() => {
    if (!open) return []
    const query = q.trim().toLowerCase()
    const close = () => useStore.setState({ paletteOpen: false })
    const out: (Item & { s: number })[] = []

    for (const b of Object.values(state.books)) {
      const s = Math.max(score(b.title, query), score(b.authors.join(' '), query) * 0.8)
      if (s > 0)
        out.push({
          key: `b-${b.id}`,
          section: 'Books',
          label: b.title,
          detail: b.authors.join(', '),
          book: b.id,
          s: s + (b.openedAt ? Math.min(0.5, b.openedAt / Date.now() / 2) : 0),
          run: () => openBook(b.id),
        })
    }
    if (query) {
      for (const sh of flattenShelves(state.shelves)) {
        const s = score(sh.name, query)
        if (s > 0)
          out.push({
            key: `s-${sh.id}`,
            section: 'Shelves',
            label: shelfPath(state.shelves, sh.id).map((x) => x.name).join(' › '),
            s,
            run: () => {
              close()
              navigate({ kind: 'shelf', id: sh.id })
            },
          })
      }
      for (const [name, n] of authorCounts(state.books)) {
        const s = score(name, query)
        if (s > 0)
          out.push({
            key: `a-${name}`,
            section: 'Authors',
            label: name,
            detail: `${n} item${n === 1 ? '' : 's'}`,
            s,
            run: () => {
              close()
              navigate({ kind: 'author', name })
            },
          })
      }
      if (query.length > 2)
        for (const a of state.annotations) {
          const text = `${a.text ?? ''} ${a.note ?? ''}`
          if (!state.books[a.bookId] || !text.toLowerCase().includes(query)) continue
          out.push({
            key: `n-${a.id}`,
            section: 'Highlights & notes',
            label: (a.text || a.note || '').slice(0, 140),
            detail: state.books[a.bookId].title,
            s: 1.5,
            run: () => openBook(a.bookId, a.locator),
          })
        }
    }
    const actions: Omit<Item, 'section' | 'key'>[] = [
      {
        label: 'Add folder to library…',
        run: async () => {
          close()
          const p = await api().pickFolder()
          if (p) addPaths([p])
        },
      },
      {
        label: 'Add files…',
        run: async () => {
          close()
          const p = await api().pickFiles()
          if (p.length) addPaths(p)
        },
      },
      { label: 'Rescan library folders', run: () => (close(), rescanAll()) },
      { label: 'New shelf group…', run: () => useStore.setState({ paletteOpen: false, shelfDialog: { mode: 'create', parentId: null } }) },
      { label: 'Settings', run: () => useStore.setState({ paletteOpen: false, settingsOpen: true }) },
      { label: 'Go to Highlights', run: () => (close(), navigate({ kind: 'highlights' })) },
      { label: 'Go to Currently Reading', run: () => (close(), navigate({ kind: 'reading' })) },
    ]
    for (const a of actions) {
      const s = score(a.label, query)
      if (s > 0 && (query || out.length < 8)) out.push({ ...a, key: `x-${a.label}`, section: 'Actions', s: s * 0.9 })
    }

    const order = ['Books', 'Shelves', 'Authors', 'Highlights & notes', 'Actions']
    const bySection = order.map((sec) =>
      out
        .filter((x) => x.section === sec)
        .sort((a, b) => b.s - a.s)
        .slice(0, sec === 'Books' ? 8 : 5),
    )
    return bySection.flat()
  }, [open, q, state.books, state.shelves, state.annotations])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && useStore.setState({ paletteOpen: false })}>
      <div className="palette" role="dialog" aria-label="Search">
        <input
          autoFocus
          className="pal-input"
          placeholder="Search books, shelves, authors, highlights…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(items.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter') items[active]?.run()
            else if (e.key === 'Escape') useStore.setState({ paletteOpen: false })
          }}
        />
        <div className="pal-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.key}>
              {(i === 0 || items[i - 1].section !== it.section) && <div className="pal-section">{it.section}</div>}
              <div className={`pal-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => it.run()}>
                {it.book && state.books[it.book] && (
                  <span className="pal-thumb">
                    <Cover book={state.books[it.book]} />
                  </span>
                )}
                <span className="pal-label">{it.label}</span>
                {it.detail && <span className="pal-detail">{it.detail}</span>}
              </div>
            </div>
          ))}
          {!items.length && <div className="pal-empty">No matches</div>}
        </div>
      </div>
    </div>
  )
}

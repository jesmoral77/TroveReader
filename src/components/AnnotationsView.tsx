import { useMemo, useState } from 'react'
import { exportAllNotes, exportBookNotes } from '../lib/exportNotes'
import { relativeDate } from '../lib/selectors'
import { openBook, removeAnnotation, upsertAnnotation, useStore } from '../lib/store'
import { HIGHLIGHT_COLORS, type Annotation, type AnnotationKind } from '../lib/types'
import { Cover } from './Cover'
import { showMenu } from './menu'

export function NoteEditor({ annotation, onDone }: { annotation: Annotation; onDone: () => void }) {
  const [value, setValue] = useState(annotation.note ?? '')
  const save = () => {
    upsertAnnotation({ ...annotation, note: value.trim() || null, updatedAt: Date.now() })
    onDone()
  }
  return (
    <div className="note-editor" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={value}
        placeholder="Write a note…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
          if (e.key === 'Escape') onDone()
          e.stopPropagation()
        }}
      />
      <div className="note-actions">
        <span className="muted small">Ctrl+Enter to save</span>
        <button className="btn sm" onClick={onDone}>
          Cancel
        </button>
        <button className="btn sm primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

export function AnnotationsView({ kind }: { kind: AnnotationKind }) {
  const { annotations, books } = useStore()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const m = new Map<string, Annotation[]>()
    for (const a of annotations) {
      if (a.kind !== kind || !books[a.bookId]) continue
      if (q && !`${a.text ?? ''} ${a.note ?? ''} ${books[a.bookId].title}`.toLowerCase().includes(q)) continue
      ;(m.get(a.bookId) ?? m.set(a.bookId, []).get(a.bookId)!).push(a)
    }
    return [...m.entries()]
      .map(([id, list]) => ({ book: books[id], list: list.sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0)) }))
      .sort((a, b) => Math.max(...b.list.map((x) => x.createdAt)) - Math.max(...a.list.map((x) => x.createdAt)))
  }, [annotations, books, kind, query])

  const total = grouped.reduce((n, g) => n + g.list.length, 0)

  return (
    <div className="notes-view">
      <div className="notes-bar">
        <input className="input" placeholder={`Filter ${kind}s…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted small">
          {total} {kind}
          {total === 1 ? '' : 's'}
        </span>
        <button className="btn sm" disabled={!total} onClick={() => exportAllNotes(kind)}>
          Export Markdown
        </button>
      </div>
      {!grouped.length && (
        <div className="empty-note">
          {kind === 'highlight'
            ? 'Select text while reading to highlight it. Highlights from every book collect here.'
            : 'Press Ctrl+D while reading to bookmark a page.'}
        </div>
      )}
      {grouped.map(({ book, list }) => (
        <section key={book.id} className="notes-book">
          <div className="notes-book-head">
            <div className="notes-thumb" onClick={() => openBook(book.id)}>
              <Cover book={book} />
            </div>
            <div>
              <div className="notes-book-title" onClick={() => openBook(book.id)}>
                {book.title}
              </div>
              <div className="muted">{book.authors.join(', ')}</div>
              <button className="link-btn small" onClick={() => exportBookNotes(book.id)}>
                Export this book’s notes
              </button>
            </div>
          </div>
          <div className="notes-list">
            {list.map((a) => (
              <div
                key={a.id}
                className="note-item"
                onClick={() => openBook(a.bookId, a.locator)}
                onContextMenu={(e) =>
                  showMenu(e, [
                    { label: 'Go to location', onClick: () => openBook(a.bookId, a.locator) },
                    { label: a.note ? 'Edit note' : 'Add note', onClick: () => setEditing(a.id) },
                    ...(a.kind === 'highlight'
                      ? [
                          { separator: true },
                          ...Object.keys(HIGHLIGHT_COLORS).map((c) => ({
                            label: c[0].toUpperCase() + c.slice(1),
                            checked: a.color === c,
                            onClick: () => upsertAnnotation({ ...a, color: c as Annotation['color'], updatedAt: Date.now() }),
                          })),
                        ]
                      : []),
                    { separator: true },
                    { label: 'Copy text', onClick: () => navigator.clipboard.writeText(a.text ?? '') },
                    { label: 'Delete', danger: true, onClick: () => removeAnnotation(a.id) },
                  ])
                }
              >
                {a.kind === 'highlight' ? (
                  <blockquote style={{ borderColor: HIGHLIGHT_COLORS[a.color] }}>{a.text}</blockquote>
                ) : (
                  <div className="bookmark-line">
                    <span className="bm-icon">❙</span> {a.text || a.label || 'Bookmark'}
                  </div>
                )}
                {editing === a.id ? (
                  <NoteEditor annotation={a} onDone={() => setEditing(null)} />
                ) : (
                  a.note && <div className="note-text">{a.note}</div>
                )}
                <div className="note-meta">
                  {a.label && <span>{a.label}</span>}
                  {a.fraction != null && <span>{Math.round(a.fraction * 100)}%</span>}
                  <span>{relativeDate(a.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

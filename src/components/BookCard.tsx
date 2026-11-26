import { memo } from 'react'
import { fractionOf, percent } from '../lib/selectors'
import { openBook, useStore } from '../lib/store'
import type { Book } from '../lib/types'
import { bookMenu } from './bookMenu'
import { Cover } from './Cover'
import { beginPotentialDrag, dragJustEnded } from './drag'
import { showMenu } from './menu'

export function handleSelectClick(e: React.MouseEvent, id: string, ordered: string[]) {
  const { selection } = useStore.getState()
  if (e.ctrlKey || e.metaKey) {
    useStore.setState({ selection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] })
    return true
  }
  if (e.shiftKey && selection.length) {
    const a = ordered.indexOf(selection[selection.length - 1])
    const b = ordered.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      useStore.setState({ selection: Array.from(new Set([...selection, ...ordered.slice(lo, hi + 1)])) })
      return true
    }
  }
  return false
}

export function onBookContextMenu(e: React.MouseEvent, id: string) {
  const { selection } = useStore.getState()
  const ids = selection.includes(id) ? selection : [id]
  if (!selection.includes(id)) useStore.setState({ selection: [id] })
  showMenu(e, bookMenu(ids))
}

export const BookCard = memo(function BookCard({ book, ordered }: { book: Book; ordered: string[] }) {
  const selected = useStore((s) => s.selection.includes(book.id))
  const fraction = useStore((s) => fractionOf(s, book))
  const author = book.authors.join(', ')

  return (
    <div
      className={`card ${selected ? 'selected' : ''} ${book.missing ? 'missing' : ''}`}
      onPointerDown={(e) => beginPotentialDrag(e, book.id)}
      onClick={(e) => {
        if (dragJustEnded) return
        if (handleSelectClick(e, book.id, ordered)) return
        if (book.missing) {
          useStore.setState({ selection: [book.id] })
          return
        }
        openBook(book.id)
      }}
      onContextMenu={(e) => onBookContextMenu(e, book.id)}
      title={book.missing ? `File not found: ${book.path}` : book.path}
      tabIndex={0}
      data-book={book.id}
      onKeyDown={(e) => e.key === 'Enter' && !book.missing && openBook(book.id)}
    >
      <div className="card-cover">
        <Cover book={book} />
        {book.starred && <span className="card-star" aria-label="Starred">★</span>}
        {book.missing && <span className="card-badge">File missing</span>}
      </div>
      <div className="card-title">{book.title}</div>
      {author && <div className="card-author">{author}</div>}
      {fraction > 0 && (
        <div className={`card-progress ${fraction >= 1 ? 'done' : ''}`}>
          {fraction >= 1 ? (
            <span>✓ Finished</span>
          ) : (
            <>
              <span className="bar">
                <i style={{ width: `${Math.max(3, fraction * 100)}%` }} />
              </span>
              <span>{percent(fraction)}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
})

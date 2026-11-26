/**
 * Pointer-based drag of books onto sidebar shelves. (HTML5 drag & drop is
 * taken over by the Tauri window on Windows so that files can be dropped
 * from Explorer, so in-app dragging is done by hand.)
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { addToShelf, useStore } from '../lib/store'

interface DragState {
  ids: string[]
  x: number
  y: number
  overShelf: number | null
}

export const useDrag = create<DragState>(() => ({ ids: [], x: 0, y: 0, overShelf: null }))

let pending: { ids: string[]; x: number; y: number } | null = null
export let dragJustEnded = false

export function beginPotentialDrag(e: React.PointerEvent, id: string) {
  if (e.button !== 0) return
  const sel = useStore.getState().selection
  pending = { ids: sel.includes(id) ? sel : [id], x: e.clientX, y: e.clientY }
}

function shelfAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-shelf]')
  return el ? Number(el.dataset.dropShelf) : null
}

export function DragLayer() {
  const { ids, x, y, overShelf } = useDrag()
  const books = useStore((s) => s.books)

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = useDrag.getState()
      if (!d.ids.length && pending) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 6) return
        useDrag.setState({ ids: pending.ids })
        document.body.classList.add('dragging')
      }
      if (useDrag.getState().ids.length) useDrag.setState({ x: e.clientX, y: e.clientY, overShelf: shelfAt(e.clientX, e.clientY) })
    }
    const up = () => {
      const d = useDrag.getState()
      pending = null
      if (!d.ids.length) return
      if (d.overShelf != null) addToShelf(d.ids, d.overShelf)
      useDrag.setState({ ids: [], overShelf: null })
      document.body.classList.remove('dragging')
      dragJustEnded = true
      setTimeout(() => (dragJustEnded = false), 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  useEffect(() => {
    document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'))
    if (overShelf != null) document.querySelector(`[data-drop-shelf="${overShelf}"]`)?.classList.add('drop-over')
  }, [overShelf])

  if (!ids.length) return null
  const first = books[ids[0]]
  return (
    <div className="drag-ghost" style={{ left: x + 14, top: y + 10 }}>
      <span className="drag-title">{first?.title ?? ''}</span>
      {ids.length > 1 && <span className="drag-count">+{ids.length - 1}</span>}
      <span className="drag-hint">{overShelf != null ? 'Add to shelf' : 'Drop on a shelf'}</span>
    </div>
  )
}

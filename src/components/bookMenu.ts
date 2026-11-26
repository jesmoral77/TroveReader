import { api } from '../lib/backend'
import { refreshMetadata, relocateBook } from '../lib/library'
import { childrenOf } from '../lib/selectors'
import {
  addToShelf,
  excludeBooks,
  openBook,
  removeFromShelf,
  resetProgress,
  setFinished,
  setType,
  toggleStar,
  updateBooks,
  useStore,
} from '../lib/store'
import { BOOK_TYPES, type Shelf } from '../lib/types'
import type { MenuItem } from './menu'

function shelfItems(shelves: Shelf[], parentId: number | null, ids: string[], links: Record<string, number[]>): MenuItem[] {
  return childrenOf(shelves, parentId).map((s) => {
    const on = ids.every((id) => links[id]?.includes(s.id))
    const kids = childrenOf(shelves, s.id)
    const toggle = () => (on ? removeFromShelf(ids, s.id) : addToShelf(ids, s.id))
    if (!kids.length) return { label: s.name, checked: on, onClick: toggle }
    return {
      label: s.name,
      checked: on,
      submenu: [
        { label: on ? `Remove from ${s.name}` : `Add to ${s.name}`, onClick: toggle },
        { separator: true },
        ...shelfItems(shelves, s.id, ids, links),
      ],
    }
  })
}

export function bookMenu(ids: string[]): MenuItem[] {
  const s = useStore.getState()
  const books = ids.map((id) => s.books[id]).filter(Boolean)
  if (!books.length) return []
  const one = books.length === 1 ? books[0] : null
  const allStarred = books.every((b) => b.starred)
  const allFinished = books.every((b) => b.finishedAt)
  const hasProgress = books.some((b) => s.progress[b.id] || b.finishedAt)
  const nav = s.nav
  const currentShelf = nav.kind === 'shelf' ? s.shelves.find((x) => x.id === nav.id) : null

  const items: MenuItem[] = []
  if (one) {
    items.push({ label: 'Open', hint: 'Enter', onClick: () => openBook(one.id), disabled: one.missing })
    if (s.progress[one.id]?.fraction) items.push({ label: 'Open from the beginning', onClick: () => openBook(one.id, '__start__') })
    if (api().isDesktop) items.push({ label: 'Show in Explorer', onClick: () => api().reveal(one.path), disabled: one.missing })
    items.push({ separator: true })
  }
  items.push({ label: allStarred ? 'Unstar' : 'Star', hint: 'S', onClick: () => toggleStar(ids) })
  items.push({ label: allFinished ? 'Mark as unread' : 'Mark as finished', onClick: () => setFinished(ids, !allFinished) })
  if (hasProgress) items.push({ label: 'Reset progress', onClick: () => resetProgress(ids) })
  items.push({ separator: true })
  items.push({ label: 'Shelves', submenu: shelfItems(s.shelves, null, ids, s.links) })
  if (currentShelf) items.push({ label: `Remove from “${currentShelf.name}”`, onClick: () => removeFromShelf(ids, currentShelf.id) })
  items.push({
    label: 'Type',
    submenu: BOOK_TYPES.map((t) => ({
      label: t.singular,
      checked: books.every((b) => b.type === t.key),
      onClick: () => setType(ids, t.key),
    })),
  })
  items.push({
    label: 'Cover',
    submenu: [
      {
        label: 'From file',
        checked: books.every((b) => b.coverMode === 'file'),
        disabled: !books.some((b) => b.coverPath),
        onClick: () => updateBooks(ids.filter((id) => s.books[id]?.coverPath), { coverMode: 'file' }),
      },
      { label: 'Generated', checked: books.every((b) => b.coverMode !== 'file'), onClick: () => updateBooks(ids, { coverMode: 'generated' }) },
    ],
  })
  items.push({ separator: true })
  if (one) items.push({ label: 'Edit details…', hint: 'F2', onClick: () => useStore.setState({ editBookId: one.id }) })
  items.push({ label: 'Re-read metadata', onClick: () => refreshMetadata(ids) })
  if (one?.missing && api().isDesktop)
    items.push({
      label: 'Locate file…',
      onClick: async () => {
        const [p] = await api().pickFiles()
        if (p) relocateBook(one.id, p)
      },
    })
  items.push({ separator: true })
  items.push({
    label: ids.length > 1 ? `Remove ${ids.length} items from library` : 'Remove from library',
    danger: true,
    onClick: async () => {
      const ok = await api().confirm(
        `Remove ${ids.length > 1 ? `${ids.length} items` : `“${one?.title}”`} from Trove? The files on disk are not deleted.`,
      )
      if (ok) excludeBooks(ids)
    },
  })
  return items
}

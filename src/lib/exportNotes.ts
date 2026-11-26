import { api } from './backend'
import { toast, useStore } from './store'
import type { Annotation, Book } from './types'

export function notesToMarkdown(book: Book, notes: Annotation[]) {
  const lines = [`# ${book.title}`]
  if (book.authors.length) lines.push(`*${book.authors.join(', ')}*`)
  lines.push('')
  const sorted = [...notes].sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
  let lastLabel: string | null = null
  for (const n of sorted) {
    if (n.label && n.label !== lastLabel) {
      lines.push(`## ${n.label}`, '')
      lastLabel = n.label
    }
    if (n.kind === 'highlight' && n.text) lines.push(...n.text.split('\n').map((l) => `> ${l}`))
    else if (n.kind === 'bookmark') lines.push(`- Bookmark${n.text ? `: ${n.text}` : ''}`)
    if (n.note) lines.push('', n.note)
    lines.push('')
  }
  return lines.join('\n')
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]+/g, '').slice(0, 120) || 'notes'

export async function exportBookNotes(bookId: string) {
  const s = useStore.getState()
  const book = s.books[bookId]
  if (!book) return
  const notes = s.annotations.filter((a) => a.bookId === bookId)
  const path = await api().pickSavePath(`${safeName(book.title)} - notes.md`, 'md')
  if (!path) return
  await api().writeTextFile(path, notesToMarkdown(book, notes))
  toast('Notes exported')
}

export async function exportAllNotes(kind: Annotation['kind']) {
  const s = useStore.getState()
  const byBook = new Map<string, Annotation[]>()
  for (const a of s.annotations) if (a.kind === kind && s.books[a.bookId]) (byBook.get(a.bookId) ?? byBook.set(a.bookId, []).get(a.bookId)!).push(a)
  const md = [...byBook.entries()].map(([id, notes]) => notesToMarkdown(s.books[id], notes)).join('\n---\n\n')
  const path = await api().pickSavePath(kind === 'highlight' ? 'Trove highlights.md' : 'Trove bookmarks.md', 'md')
  if (!path) return
  await api().writeTextFile(path, md)
  toast('Exported')
}

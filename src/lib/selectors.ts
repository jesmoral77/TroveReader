import type { State } from './store'
import { BOOK_TYPES, type Book, type BookType, type GroupKey, type NavView, type Shelf, type SortKey } from './types'

export function childrenOf(shelves: Shelf[], parentId: number | null) {
  return shelves.filter((s) => s.parentId === parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

export function descendantIds(shelves: Shelf[], id: number): Set<number> {
  const out = new Set([id])
  let frontier = [id]
  while (frontier.length) {
    const next = shelves.filter((s) => s.parentId != null && frontier.includes(s.parentId)).map((s) => s.id)
    next.forEach((n) => out.add(n))
    frontier = next
  }
  return out
}

export function shelfPath(shelves: Shelf[], id: number): Shelf[] {
  const path: Shelf[] = []
  let cur = shelves.find((s) => s.id === id)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId == null ? undefined : shelves.find((s) => s.id === cur!.parentId)
  }
  return path
}

export const fractionOf = (s: Pick<State, 'progress'>, b: Book) => (b.finishedAt ? 1 : (s.progress[b.id]?.fraction ?? 0))

export function booksForView(s: State, view: NavView): Book[] {
  const all = Object.values(s.books)
  const present = all.filter((b) => !b.missing)
  switch (view.kind) {
    case 'all':
      return all
    case 'inbox':
      return present.filter((b) => !(s.links[b.id]?.length) && !b.finishedAt)
    case 'reading':
      return present.filter((b) => !b.finishedAt && (s.progress[b.id]?.fraction ?? 0) > 0)
    case 'recent':
      return all
        .filter((b) => b.openedAt)
        .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
        .slice(0, 60)
    case 'starred':
      return all.filter((b) => b.starred)
    case 'finished':
      return all.filter((b) => b.finishedAt)
    case 'missing':
      return all.filter((b) => b.missing)
    case 'shelf': {
      const ids = descendantIds(s.shelves, view.id)
      return all.filter((b) => s.links[b.id]?.some((x) => ids.has(x)))
    }
    case 'author':
      return all.filter((b) => b.authors.includes(view.name))
    case 'authors':
      return all.filter((b) => b.authors.length)
    default:
      return []
  }
}

export function authorCounts(books: Record<string, Book>) {
  const m = new Map<string, number>()
  for (const b of Object.values(books)) for (const a of b.authors) m.set(a, (m.get(a) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const sortTitle = (t: string) => t.replace(/^(the|a|an)\s+/i, '')

export function sortBooks(books: Book[], key: SortKey, s: Pick<State, 'progress'>) {
  const arr = [...books]
  switch (key) {
    case 'title':
      return arr.sort((a, b) => collator.compare(sortTitle(a.title), sortTitle(b.title)))
    case 'author':
      return arr.sort(
        (a, b) => collator.compare(a.authors[0] ?? '￿', b.authors[0] ?? '￿') || collator.compare(a.title, b.title),
      )
    case 'added':
      return arr.sort((a, b) => b.addedAt - a.addedAt)
    case 'opened':
      return arr.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || collator.compare(a.title, b.title))
    case 'progress':
      return arr.sort((a, b) => fractionOf(s, b) - fractionOf(s, a) || collator.compare(a.title, b.title))
  }
}

export interface Group {
  key: string
  /** breadcrumb parts, e.g. ["Projects", "Dialogic Studio"] */
  title: string[]
  shelfIds?: number[]
  books: Book[]
}

export function defaultGroup(view: NavView): GroupKey {
  if (view.kind === 'all') return 'shelf'
  if (view.kind === 'shelf') return 'shelf'
  if (view.kind === 'authors') return 'author'
  return 'none'
}

/** Groups books; with `shelf` grouping a book appears once under every leaf shelf it is on. */
export function groupBooks(books: Book[], group: GroupKey, s: State, view: NavView): Group[] {
  if (group === 'none') return [{ key: 'all', title: [], books }]
  if (group === 'type') {
    return BOOK_TYPES.map((t) => ({ key: t.key, title: [t.label], books: books.filter((b) => b.type === t.key) })).filter(
      (g) => g.books.length,
    )
  }
  if (group === 'author') {
    const m = new Map<string, Book[]>()
    for (const b of books) for (const a of b.authors.length ? b.authors : ['Unknown author']) (m.get(a) ?? m.set(a, []).get(a)!).push(b)
    return [...m.entries()]
      .sort((a, b) => (a[0] === 'Unknown author' ? 1 : b[0] === 'Unknown author' ? -1 : collator.compare(a[0], b[0])))
      .map(([a, list]) => ({ key: a, title: [a], books: list }))
  }
  // shelf grouping
  const scope = view.kind === 'shelf' ? descendantIds(s.shelves, view.id) : null
  const groups = new Map<number, Book[]>()
  const loose: Book[] = []
  for (const b of books) {
    const ids = (s.links[b.id] ?? []).filter((id) => !scope || scope.has(id))
    if (!ids.length) loose.push(b)
    for (const id of ids) (groups.get(id) ?? groups.set(id, []).get(id)!).push(b)
  }
  const order = flattenShelves(s.shelves)
  const out: Group[] = order
    .filter((sh) => groups.has(sh.id))
    .map((sh) => ({
      key: `shelf-${sh.id}`,
      title: shelfPath(s.shelves, sh.id).map((p) => p.name),
      shelfIds: shelfPath(s.shelves, sh.id).map((p) => p.id),
      books: groups.get(sh.id)!,
    }))
  if (loose.length) out.push({ key: 'loose', title: [scope ? 'Directly on this shelf' : 'Not on a shelf'], books: loose })
  return out
}

/** Depth-first order of all shelves. */
export function flattenShelves(shelves: Shelf[]): Shelf[] {
  const out: Shelf[] = []
  const walk = (parentId: number | null) => {
    for (const s of childrenOf(shelves, parentId)) {
      out.push(s)
      walk(s.id)
    }
  }
  walk(null)
  return out
}

export function typeCounts(books: Book[]) {
  const m: Partial<Record<BookType, number>> = {}
  for (const b of books) m[b.type] = (m[b.type] ?? 0) + 1
  return m
}

export function viewTitle(s: State, view: NavView): string {
  switch (view.kind) {
    case 'inbox':
      return 'Inbox'
    case 'all':
      return 'All Books'
    case 'reading':
      return 'Currently Reading'
    case 'recent':
      return 'Recent'
    case 'starred':
      return 'Starred'
    case 'finished':
      return 'Finished'
    case 'missing':
      return 'Missing Files'
    case 'bookmarks':
      return 'Bookmarks'
    case 'highlights':
      return 'Highlights'
    case 'authors':
      return 'Authors'
    case 'author':
      return view.name
    case 'shelf':
      return s.shelves.find((x) => x.id === view.id)?.name ?? 'Shelf'
  }
}

export const percent = (f: number) => `${Math.round(f * 100)}%`

export function formatDuration(ms: number) {
  const min = Math.round(ms / 60000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function relativeDate(ts: number) {
  const d = Date.now() - ts
  const day = 86400000
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)} min ago`
  if (d < day) return `${Math.floor(d / 3600000)}h ago`
  if (d < 7 * day) return `${Math.floor(d / day)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

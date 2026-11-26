import { create } from 'zustand'
import * as db from './db'
import type {
  Annotation,
  Book,
  BookType,
  GroupKey,
  LayoutKey,
  LibraryFolder,
  NavView,
  Progress,
  Shelf,
  SortKey,
} from './types'

export interface ReaderTarget {
  bookId: string
  locator?: string | null
}

interface UiPrefs {
  layout: LayoutKey
  coverSize: number
  sort: SortKey
  group: GroupKey | 'default'
  expanded: number[]
  authorsExpanded: boolean
  sidebarWidth: number
}

export interface State extends UiPrefs {
  ready: boolean
  books: Record<string, Book>
  folders: LibraryFolder[]
  shelves: Shelf[]
  /** bookId -> shelf ids */
  links: Record<string, number[]>
  progress: Record<string, Progress>
  annotations: Annotation[]

  nav: NavView
  back: NavView[]
  forward: NavView[]
  typeFilter: BookType | 'all'
  selection: string[]
  status: string | null
  reader: ReaderTarget | null

  paletteOpen: boolean
  settingsOpen: boolean
  editBookId: string | null
  shelfDialog: { mode: 'create'; parentId: number | null } | { mode: 'rename'; id: number } | null
  toast: string | null
}

export const useStore = create<State>(() => ({
  ready: false,
  books: {},
  folders: [],
  shelves: [],
  links: {},
  progress: {},
  annotations: [],

  nav: { kind: 'all' },
  back: [],
  forward: [],
  typeFilter: 'all',
  selection: [],
  status: null,
  reader: null,

  paletteOpen: false,
  settingsOpen: false,
  editBookId: null,
  shelfDialog: null,
  toast: null,

  layout: 'shelf',
  coverSize: 150,
  sort: 'title',
  group: 'default',
  expanded: [],
  authorsExpanded: false,
  sidebarWidth: 300,
}))

const set = useStore.setState
const get = useStore.getState

// ---------------------------------------------------------------------------
// Loading & preferences
// ---------------------------------------------------------------------------

export async function reloadLibrary() {
  const data = await db.loadAll()
  const links: Record<string, number[]> = {}
  for (const [b, s] of data.links) (links[b] ??= []).push(s)
  set({
    books: Object.fromEntries(data.books.map((b) => [b.id, b])),
    folders: data.folders,
    shelves: data.shelves,
    links,
    progress: Object.fromEntries(data.progress.map((p) => [p.bookId, p])),
    annotations: data.annotations,
  })
}

const PREF_KEYS: (keyof UiPrefs)[] = ['layout', 'coverSize', 'sort', 'group', 'expanded', 'authorsExpanded', 'sidebarWidth']

export async function loadPrefs() {
  const prefs = await db.getSetting<Partial<UiPrefs>>('ui', {})
  const expandedDefault = get().shelves.filter((s) => s.parentId == null).map((s) => s.id)
  set({ ...prefs, expanded: prefs.expanded ?? expandedDefault })
}

let prefTimer: ReturnType<typeof setTimeout> | undefined
export function setPrefs(p: Partial<UiPrefs>) {
  set(p)
  clearTimeout(prefTimer)
  prefTimer = setTimeout(() => {
    const s = get()
    db.setSetting('ui', Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]])))
  }, 400)
}

export function toast(message: string) {
  set({ toast: message })
  setTimeout(() => {
    if (get().toast === message) set({ toast: null })
  }, 2600)
}

export function setStatus(status: string | null) {
  set({ status })
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const sameView = (a: NavView, b: NavView) => JSON.stringify(a) === JSON.stringify(b)

export function navigate(view: NavView) {
  const { nav, back, reader } = get()
  if (reader) set({ reader: null })
  if (sameView(nav, view)) return
  set({ nav: view, back: [...back, nav].slice(-50), forward: [], selection: [], typeFilter: 'all' })
}

export function goBack() {
  const { nav, back, forward } = get()
  if (!back.length) return
  set({ nav: back[back.length - 1], back: back.slice(0, -1), forward: [nav, ...forward], selection: [] })
}

export function goForward() {
  const { nav, back, forward } = get()
  if (!forward.length) return
  set({ nav: forward[0], forward: forward.slice(1), back: [...back, nav], selection: [] })
}

export function openBook(bookId: string, locator?: string | null) {
  set({ reader: { bookId, locator }, paletteOpen: false })
}

export function closeReader() {
  set({ reader: null })
}

// ---------------------------------------------------------------------------
// Book mutations
// ---------------------------------------------------------------------------

export function patchBooksLocal(patches: Record<string, Partial<Book>>) {
  set((s) => {
    const books = { ...s.books }
    for (const [id, p] of Object.entries(patches)) if (books[id]) books[id] = { ...books[id], ...p }
    return { books }
  })
}

export async function updateBooks(ids: string[], patch: Partial<Book>, extra: Record<string, string | number | null> = {}) {
  await Promise.all(ids.map((id) => db.updateBook(id, patch, extra)))
  patchBooksLocal(Object.fromEntries(ids.map((id) => [id, patch])))
}

export async function toggleStar(ids: string[]) {
  const books = get().books
  const starred = !ids.every((id) => books[id]?.starred)
  await updateBooks(ids, { starred })
}

export async function setFinished(ids: string[], finished: boolean) {
  await updateBooks(ids, { finishedAt: finished ? Date.now() : null })
  if (finished) {
    for (const id of ids) {
      const prev = get().progress[id]
      const p: Progress = { bookId: id, locator: prev?.locator ?? null, fraction: 1, label: prev?.label ?? null, updatedAt: Date.now() }
      await db.saveProgress(p)
      set((s) => ({ progress: { ...s.progress, [id]: p } }))
    }
  }
}

export async function resetProgress(ids: string[]) {
  await updateBooks(ids, { finishedAt: null })
  for (const id of ids) await db.clearProgress(id)
  set((s) => {
    const progress = { ...s.progress }
    for (const id of ids) delete progress[id]
    return { progress }
  })
}

export async function setType(ids: string[], type: BookType) {
  await updateBooks(ids, { type }, { type_auto: 0 })
}

export async function excludeBooks(ids: string[]) {
  await updateBooks(ids, { excluded: true })
  set((s) => {
    const books = { ...s.books }
    for (const id of ids) delete books[id]
    return { books, selection: [] }
  })
}

export async function saveProgress(p: Progress) {
  set((s) => ({ progress: { ...s.progress, [p.bookId]: p } }))
  await db.saveProgress(p)
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

export async function addToShelf(ids: string[], shelfId: number) {
  const now = Date.now()
  await db.batchAddLinks(ids, shelfId, now)
  set((s) => {
    const links = { ...s.links }
    for (const id of ids) links[id] = Array.from(new Set([...(links[id] ?? []), shelfId]))
    return { links }
  })
  const shelf = get().shelves.find((s) => s.id === shelfId)
  if (shelf) toast(`Added ${ids.length === 1 ? '1 item' : `${ids.length} items`} to ${shelf.name}`)
}

export async function removeFromShelf(ids: string[], shelfId: number) {
  await db.batchRemoveLinks(ids, shelfId)
  set((s) => {
    const links = { ...s.links }
    for (const id of ids) links[id] = (links[id] ?? []).filter((x) => x !== shelfId)
    return { links }
  })
}

export async function createShelf(parentId: number | null, name: string) {
  const siblings = get().shelves.filter((s) => s.parentId === parentId)
  const id = await db.insertShelf(parentId, name, siblings.length)
  set((s) => ({
    shelves: [...s.shelves, { id, parentId, name, sort: siblings.length }],
    expanded: parentId != null && !s.expanded.includes(parentId) ? [...s.expanded, parentId] : s.expanded,
  }))
  return id
}

export async function renameShelf(id: number, name: string) {
  await db.renameShelf(id, name)
  set((s) => ({ shelves: s.shelves.map((x) => (x.id === id ? { ...x, name } : x)) }))
}

export async function deleteShelf(id: number) {
  await db.deleteShelf(id)
  await reloadLibrary()
  const nav = get().nav
  if (nav.kind === 'shelf' && !get().shelves.some((s) => s.id === nav.id)) set({ nav: { kind: 'all' } })
}

export function toggleExpanded(id: number) {
  const expanded = get().expanded
  setPrefs({ expanded: expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id] })
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export async function upsertAnnotation(a: Annotation) {
  await db.saveAnnotation(a)
  set((s) => {
    const i = s.annotations.findIndex((x) => x.id === a.id)
    const annotations = [...s.annotations]
    if (i >= 0) annotations[i] = a
    else annotations.push(a)
    return { annotations }
  })
}

export async function removeAnnotation(id: string) {
  await db.deleteAnnotation(id)
  set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) }))
}

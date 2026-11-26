export type Format = 'pdf' | 'epub' | 'mobi' | 'azw3' | 'fb2' | 'cbz' | 'txt' | 'md' | 'html'

export type BookType =
  | 'book'
  | 'summary'
  | 'article'
  | 'paper'
  | 'course'
  | 'conversation'
  | 'talk'
  | 'comic'
  | 'unsorted'

export const BOOK_TYPES: { key: BookType; label: string; singular: string }[] = [
  { key: 'book', label: 'Books', singular: 'Book' },
  { key: 'summary', label: 'Summaries', singular: 'Summary' },
  { key: 'article', label: 'Articles', singular: 'Article' },
  { key: 'paper', label: 'Papers', singular: 'Paper' },
  { key: 'course', label: 'Course Materials', singular: 'Course Material' },
  { key: 'conversation', label: 'Conversations', singular: 'Conversation' },
  { key: 'talk', label: 'Talks', singular: 'Talk' },
  { key: 'comic', label: 'Comics', singular: 'Comic' },
  { key: 'unsorted', label: 'Unsorted', singular: 'Unsorted' },
]

export type CoverMode = 'auto' | 'file' | 'generated'

export interface Book {
  id: string
  path: string
  hash: string | null
  format: Format
  size: number
  mtime: number
  title: string
  authors: string[]
  type: BookType
  pages: number | null
  coverPath: string | null
  coverMode: CoverMode
  starred: boolean
  finishedAt: number | null
  addedAt: number
  openedAt: number | null
  missing: boolean
  excluded: boolean
  metaDone: boolean
  folderId: number | null
  description: string | null
  publisher: string | null
  language: string | null
  year: string | null
}

export interface LibraryFolder {
  id: number
  path: string
  addedAt: number
}

/** A shelf. Root shelves (parentId = null) are groups such as "Projects" or "Topics". */
export interface Shelf {
  id: number
  parentId: number | null
  name: string
  sort: number
}

export interface Progress {
  bookId: string
  locator: string | null
  fraction: number
  label: string | null
  updatedAt: number
}

export type AnnotationKind = 'bookmark' | 'highlight'

export interface Annotation {
  id: string
  bookId: string
  kind: AnnotationKind
  locator: string
  text: string | null
  note: string | null
  color: HighlightColor
  label: string | null
  fraction: number | null
  createdAt: number
  updatedAt: number
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#f5d76e',
  green: '#9fd58b',
  blue: '#8cc4f0',
  pink: '#f2a0b8',
  purple: '#c3a6f0',
}

export interface ReadingSession {
  bookId: string
  startedAt: number
  endedAt: number
  startFraction: number
  endFraction: number
}

export type NavView =
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'reading' }
  | { kind: 'recent' }
  | { kind: 'starred' }
  | { kind: 'finished' }
  | { kind: 'missing' }
  | { kind: 'bookmarks' }
  | { kind: 'highlights' }
  | { kind: 'shelf'; id: number }
  | { kind: 'authors' }
  | { kind: 'author'; name: string }

export type SortKey = 'title' | 'author' | 'added' | 'opened' | 'progress'
export type GroupKey = 'none' | 'shelf' | 'author' | 'type'
export type LayoutKey = 'shelf' | 'list'

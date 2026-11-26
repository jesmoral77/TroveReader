// Minimal typings for the parts of foliate-js that Trove uses.

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

export interface FoliateBook {
  metadata?: any
  toc?: TocItem[]
  dir?: string
  sections: { size?: number; linear?: string; cfi?: string; createDocument?: () => Promise<Document> }[]
  getCover?: () => Promise<Blob | null>
  destroy?: () => void
}

export interface RelocateDetail {
  fraction: number
  cfi: string
  tocItem?: { label?: string; href?: string }
  pageItem?: { label?: string }
  location?: { current: number; next: number; total: number }
  section?: { current: number; total: number }
  time?: { section: number; total: number }
}

export interface SearchExcerpt {
  pre: string
  match: string
  post: string
}

export type SearchResult =
  | 'done'
  | { progress: number }
  | { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] }

export interface FoliateRenderer extends HTMLElement {
  setStyles?: (css: string | [string, string]) => void
  getContents(): { doc: Document; index: number; overlayer?: unknown }[]
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  scrollToAnchor?(range: Range, select?: boolean): void
}

export class View extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  lastLocation: RelocateDetail | null
  open(book: File | Blob | FoliateBook): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number | { fraction: number }): Promise<unknown>
  goToFraction(frac: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  getCFI(index: number, range?: Range): string
  addAnnotation(annotation: { value: string; color?: string }, remove?: boolean): Promise<unknown>
  deleteAnnotation(annotation: { value: string }): Promise<unknown>
  showAnnotation(annotation: { value: string }): Promise<void>
  search(opts: { query: string; index?: number; matchCase?: boolean; matchWholeWords?: boolean }): AsyncGenerator<SearchResult>
  clearSearch(): void
  deselect(): void
  getSectionFractions(): number[]
}

export function makeBook(file: File | Blob): Promise<FoliateBook>

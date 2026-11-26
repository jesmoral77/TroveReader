import type { Annotation, Book } from '../lib/types'

export interface TocEntry {
  label: string
  target: string
  depth: number
}

export interface Relocation {
  locator: string
  fraction: number
  /** chapter / section title */
  chapter: string | null
  /** e.g. "Page 12 of 300" or "Loc 120 of 3400" */
  position: string
  page?: number
  pageCount?: number
}

export interface SelectionInfo {
  text: string
  locator: string
  rect: DOMRect
  chapter: string | null
  fraction: number
}

export interface SearchHit {
  locator: string
  pre: string
  match: string
  post: string
  label?: string
}

export interface EngineHandle {
  goTo(locator: string): void
  goToFraction(f: number): void
  next(): void
  prev(): void
  search(query: string, onHits: (hits: SearchHit[]) => void, onProgress: (p: number) => void, signal: AbortSignal): Promise<void>
  clearSearch(): void
  clearSelection(): void
  /** Flash a highlight/search target after jumping to it */
  showTarget?(locator: string): void
  /** Current position in KOReader's format (page number or XPointer), for progress sync */
  koPosition?(): { progress: string; percentage: number } | null
  /** Go to a position received from KOReader. Resolves to false if only the percentage could be used. */
  goToKo?(progress: string, percentage: number): Promise<boolean>
}

export type ThemeKey = 'dark' | 'black' | 'sepia' | 'light'
export type FontKey = 'serif' | 'sans' | 'mono' | 'publisher'

export interface Appearance {
  theme: ThemeKey
  font: FontKey
  fontSize: number
  lineHeight: number
  width: number
  flow: 'paginated' | 'scrolled'
  columns: 1 | 2
  justify: boolean
}

export interface PdfSettings {
  zoom: 'fit-width' | 'fit-page' | number
  spread: boolean
  darkPages: boolean
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.6,
  width: 680,
  flow: 'paginated',
  columns: 2,
  justify: true,
}

export const DEFAULT_PDF: PdfSettings = { zoom: 'fit-width', spread: false, darkPages: false }

export const THEMES: Record<ThemeKey, { bg: string; fg: string; muted: string; link: string; label: string }> = {
  dark: { bg: '#1f1d1b', fg: '#ddd6ca', muted: '#8c857a', link: '#9cc4e4', label: 'Dark' },
  black: { bg: '#000000', fg: '#c9c9c9', muted: '#777', link: '#8ab4e8', label: 'Black' },
  sepia: { bg: '#f3ead6', fg: '#46392a', muted: '#8b7a62', link: '#2f5d8a', label: 'Sepia' },
  light: { bg: '#fbfaf7', fg: '#222222', muted: '#777', link: '#2456a8', label: 'Light' },
}

export interface EngineProps {
  book: Book
  data: ArrayBuffer
  initialLocator: string | null
  appearance: Appearance
  pdf: PdfSettings
  highlights: Annotation[]
  onReady(toc: TocEntry[]): void
  onRelocate(r: Relocation): void
  onSelection(s: SelectionInfo | null): void
  onHighlightClick(id: string, rect: DOMRect): void
  onKey(e: KeyboardEvent): void
  onError(message: string): void
}

/**
 * Extracts title, authors, page count and a cover thumbnail from a file.
 * Runs in the webview using the same engines as the reader.
 */
import { api } from './backend'
import { openPdf } from './pdf'
import type { Book, BookType, Format } from './types'

export interface Extracted {
  title?: string
  authors?: string[]
  pages?: number
  description?: string
  publisher?: string
  language?: string
  year?: string
  /** base64 JPEG */
  cover?: string
  /** true when the cover looks like designed artwork rather than a page of text */
  coverIsArt?: boolean
}

const THUMB_WIDTH = 360

export function formatFromExt(ext: string): Format | null {
  switch (ext.toLowerCase()) {
    case 'pdf':
      return 'pdf'
    case 'epub':
      return 'epub'
    case 'mobi':
    case 'azw':
    case 'kf8':
      return 'mobi'
    case 'azw3':
      return 'azw3'
    case 'fb2':
    case 'fbz':
      return 'fb2'
    case 'cbz':
      return 'cbz'
    case 'txt':
      return 'txt'
    case 'md':
    case 'markdown':
      return 'md'
    case 'html':
    case 'htm':
      return 'html'
    default:
      return null
  }
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

/** "the_artists-struggle.pdf" -> "The artists struggle" */
export function titleFromPath(path: string) {
  let name = fileName(path).replace(/\.[^.]+$/, '')
  if (!name.includes(' ')) name = name.replace(/[_]+/g, ' ')
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return name ? name[0].toUpperCase() + name.slice(1) : 'Untitled'
}

export function autoType(format: Format, pages: number | null): BookType {
  if (format === 'cbz') return 'comic'
  if (format === 'pdf') return pages != null && pages >= 80 ? 'book' : 'unsorted'
  if (format === 'txt' || format === 'md' || format === 'html') return 'article'
  return 'book'
}

const JUNK_TITLE = /^(untitled|microsoft word|document\d*|untitled document|slide \d+|\s*)$|\.(docx?|pptx?|indd|tex|qxd)\b|^[\w-]+\.(pdf)$/i

function cleanTitle(t: unknown): string | undefined {
  if (typeof t !== 'string') return undefined
  const s = t
    .replace(/^Microsoft (Word|PowerPoint) - /i, '')
    .replace(/\.(cbz|cbr|epub|pdf|mobi|azw3?|fb2|txt|md)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length < 2 || JUNK_TITLE.test(s)) return undefined
  return s
}

function splitAuthors(s: unknown): string[] | undefined {
  if (typeof s !== 'string' || !s.trim()) return undefined
  return s
    .split(/\s*(?:;|&|\band\b)\s*/i)
    .flatMap((a) => (a.split(',').length > 2 ? a.split(',') : [a]))
    .map((a) => a.trim())
    .filter(Boolean)
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<{ data: string; whiteness: number }> {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height).data
  let white = 0
  let total = 0
  for (let i = 0; i < img.length; i += 4 * 7) {
    total++
    if (img[i] > 235 && img[i + 1] > 235 && img[i + 2] > 235) white++
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), whiteness: white / Math.max(1, total) }
}

async function blobToThumb(blob: Blob) {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, THUMB_WIDTH / bmp.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvasToJpeg(canvas)
}

async function extractPdf(data: ArrayBuffer): Promise<Extracted> {
  const pdf = await openPdf(data)
  try {
    const out: Extracted = { pages: pdf.numPages }
    const meta = await pdf.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as Record<string, unknown>
    out.title = cleanTitle(meta?.metadata?.get('dc:title')) ?? cleanTitle(info.Title)
    out.authors = splitAuthors(meta?.metadata?.get('dc:creator') ?? info.Author)
    const created = String(info.CreationDate ?? '')
    const m = created.match(/D:(\d{4})/)
    if (m) out.year = m[1]

    const page = await pdf.getPage(1)
    const vp1 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMB_WIDTH / vp1.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const { data: jpeg, whiteness } = await canvasToJpeg(canvas)
    out.cover = jpeg
    out.coverIsArt = whiteness < 0.55
    return out
  } finally {
    pdf.close()
  }
}

type LangMap = string | Record<string, string> | undefined
const fromLangMap = (x: LangMap) => (!x ? undefined : typeof x === 'string' ? x : Object.values(x)[0])
type Contributor = string | { name?: LangMap } | undefined
const contributorName = (c: Contributor) => (typeof c === 'string' ? c : fromLangMap(c?.name))

async function extractEbook(data: ArrayBuffer, name: string): Promise<Extracted> {
  const { makeBook } = await import('../vendor/foliate/view.js')
  const book = await makeBook(new File([data], name))
  const md = book.metadata ?? {}
  const authors = (Array.isArray(md.author) ? md.author : md.author ? [md.author] : [])
    .map(contributorName)
    .filter((s: string | undefined): s is string => !!s)
  const out: Extracted = {
    title: cleanTitle(fromLangMap(md.title)),
    authors: authors.length ? authors : undefined,
    language: Array.isArray(md.language) ? md.language[0] : md.language,
    publisher: contributorName(md.publisher),
    description: typeof md.description === 'string' ? md.description.replace(/<[^>]+>/g, '').slice(0, 2000) : undefined,
    year: typeof md.published === 'string' ? md.published.slice(0, 4) : undefined,
  }
  try {
    const blob = await book.getCover?.()
    if (blob) {
      const { data: jpeg } = await blobToThumb(blob)
      out.cover = jpeg
      out.coverIsArt = true
    }
  } catch {
    /* no cover */
  }
  book.destroy?.()
  return out
}

async function extractText(data: ArrayBuffer, format: Format): Promise<Extracted> {
  const text = new TextDecoder().decode(data.slice(0, 64 * 1024))
  if (format === 'md') {
    const h = text.match(/^#\s+(.+)$/m)
    const author = text.match(/^(?:author|by):\s*(.+)$/im)
    return { title: h?.[1].trim(), authors: author ? splitAuthors(author[1]) : undefined }
  }
  if (format === 'html') {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    const author = doc.querySelector('meta[name="author"]')?.getAttribute('content')
    return { title: cleanTitle(doc.title) ?? doc.querySelector('h1')?.textContent?.trim(), authors: splitAuthors(author) }
  }
  return {}
}

export async function extractMetadata(book: Book): Promise<Extracted> {
  const data = await api().readFile(book.path)
  switch (book.format) {
    case 'pdf':
      return extractPdf(data)
    case 'txt':
    case 'md':
    case 'html':
      return extractText(data, book.format)
    default:
      return extractEbook(data, fileName(book.path))
  }
}

/**
 * PDF viewer built on PDF.js: continuous scrolling, lazy page rendering,
 * selectable text layer, highlights, outline and full-text search.
 *
 * Locators:
 *   pdf:<page>:<yFraction>         a reading position
 *   pdfhl:<json [{p, r:[[x,y,w,h]]}]>  a highlight (normalised page coords)
 *   pdfs:<page>:<json [x,y,w,h]>   a search hit
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { openPdf, pdfjs, type PdfDoc } from '../lib/pdf'
import { HIGHLIGHT_COLORS, type Annotation } from '../lib/types'
import type { EngineHandle, EngineProps, TocEntry } from './types'

type Rect = [number, number, number, number]
interface HlPart {
  p: number
  r: Rect[]
}

const PAD = 24
const GAP = 16

export function parseHighlight(locator: string): HlPart[] | null {
  if (!locator.startsWith('pdfhl:')) return null
  try {
    return JSON.parse(locator.slice(6))
  } catch {
    return null
  }
}

function parsePosition(locator: string): { page: number; y: number; mark?: Rect } | null {
  if (locator.startsWith('pdf:')) {
    const [, p, y] = locator.split(':')
    return { page: Number(p) || 1, y: Number(y) || 0 }
  }
  if (locator.startsWith('pdfs:')) {
    const i = locator.indexOf(':', 5)
    const page = Number(locator.slice(5, i))
    const mark = JSON.parse(locator.slice(i + 1)) as Rect
    return { page, y: Math.max(0, mark[1] - 0.15), mark }
  }
  const hl = parseHighlight(locator)
  if (hl?.length) return { page: hl[0].p, y: Math.max(0, (hl[0].r[0]?.[1] ?? 0) - 0.15) }
  return null
}

/** Merges the many small rects PDF.js text spans produce into one per line run. */
function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: Rect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[1] - r[1]) < last[3] * 0.5 && r[0] <= last[0] + last[2] + 0.02) {
      const x2 = Math.max(last[0] + last[2], r[0] + r[2])
      const y2 = Math.max(last[1] + last[3], r[1] + r[3])
      last[0] = Math.min(last[0], r[0])
      last[1] = Math.min(last[1], r[1])
      last[2] = x2 - last[0]
      last[3] = y2 - last[1]
    } else out.push([...r] as Rect)
  }
  return out
}

interface PageState {
  el: HTMLDivElement
  canvas: HTMLCanvasElement | null
  text: HTMLDivElement | null
  hl: HTMLDivElement
  renderedScale: number
  rendering: boolean
  task?: { cancel(): void }
}

export const PdfEngine = forwardRef<EngineHandle, EngineProps>(function PdfEngine(props, ref) {
  const scroller = useRef<HTMLDivElement>(null)
  const pagesEl = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const st = useRef({
    pdf: null as PdfDoc | null,
    sizes: [] as { w: number; h: number }[],
    pages: [] as PageState[],
    scale: 1,
    current: 1,
    labels: null as string[] | null,
    outline: [] as { label: string; page: number }[],
    observer: null as IntersectionObserver | null,
    visible: new Set<number>(),
    highlights: [] as Annotation[],
    marks: new Map<number, Rect[]>(),
    restoring: false,
  })

  // ---- layout -------------------------------------------------------------

  const computeScale = () => {
    const s = st.current
    const el = scroller.current
    if (!el || !s.sizes.length) return 1
    const { zoom, spread } = propsRef.current.pdf
    if (typeof zoom === 'number') return zoom
    const maxW = Math.max(...s.sizes.map((x) => x.w))
    const maxH = Math.max(...s.sizes.map((x) => x.h))
    const availW = el.clientWidth - PAD * 2 - (spread ? GAP : 0)
    const widthScale = availW / (spread ? maxW * 2 : maxW)
    if (zoom === 'fit-page') return Math.min(widthScale, (el.clientHeight - PAD * 2) / maxH)
    // fit width, but don't blow single pages up beyond a comfortable reading width
    return Math.min(widthScale, (spread ? 1800 : 1000) / (spread ? maxW * 2 : maxW))
  }

  const layout = () => {
    const s = st.current
    s.scale = computeScale()
    s.pages.forEach((p, i) => {
      const size = s.sizes[i] ?? s.sizes[0]
      p.el.style.width = `${Math.floor(size.w * s.scale)}px`
      p.el.style.height = `${Math.floor(size.h * s.scale)}px`
      p.el.style.setProperty('--total-scale-factor', String(s.scale))
    })
    pagesEl.current?.classList.toggle('spread', propsRef.current.pdf.spread)
  }

  const currentLocator = () => {
    const s = st.current
    const el = scroller.current
    if (!el || !s.pages.length) return null
    const probe = el.scrollTop + el.clientHeight * 0.25
    let page = 1
    for (let i = 0; i < s.pages.length; i++) {
      if (s.pages[i].el.offsetTop <= probe) page = i + 1
      else break
    }
    const pe = s.pages[page - 1].el
    const y = Math.min(1, Math.max(0, (el.scrollTop - pe.offsetTop + PAD) / pe.offsetHeight))
    return { page, y }
  }

  const scrollToPos = (page: number, y: number) => {
    const s = st.current
    const el = scroller.current
    const pe = s.pages[Math.min(s.pages.length, Math.max(1, page)) - 1]?.el
    if (!el || !pe) return
    el.scrollTop = pe.offsetTop - PAD + y * pe.offsetHeight
  }

  const report = () => {
    const s = st.current
    const pos = currentLocator()
    if (!pos || s.restoring) return
    s.current = pos.page
    const n = s.pages.length
    const label = s.labels?.[pos.page - 1]
    const chapter = [...s.outline].reverse().find((o) => o.page <= pos.page)?.label ?? null
    propsRef.current.onRelocate({
      locator: `pdf:${pos.page}:${pos.y.toFixed(4)}`,
      fraction: n <= 1 ? pos.y : Math.min(1, (pos.page - 1 + pos.y) / n),
      chapter,
      position: label && label !== String(pos.page) ? `Page ${label} (${pos.page} of ${n})` : `Page ${pos.page} of ${n}`,
      page: pos.page,
      pageCount: n,
    })
    releaseFarPages(pos.page)
  }

  // ---- rendering ----------------------------------------------------------

  const drawHighlights = (index: number) => {
    const s = st.current
    const page = s.pages[index]
    if (!page) return
    page.hl.replaceChildren()
    for (const a of s.highlights) {
      for (const part of parseHighlight(a.locator) ?? []) {
        if (part.p !== index + 1) continue
        for (const [x, y, w, h] of part.r) {
          const d = document.createElement('div')
          d.className = 'pdf-hl'
          d.dataset.id = a.id
          Object.assign(d.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, background: HIGHLIGHT_COLORS[a.color] })
          page.hl.append(d)
        }
      }
    }
    for (const [x, y, w, h] of s.marks.get(index + 1) ?? []) {
      const d = document.createElement('div')
      d.className = 'pdf-mark'
      Object.assign(d.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` })
      page.hl.append(d)
    }
  }

  const renderPage = async (index: number) => {
    const s = st.current
    const page = s.pages[index]
    if (!page || !s.pdf || page.rendering || page.renderedScale === s.scale) return
    page.rendering = true
    const scale = s.scale
    try {
      const pdfPage = await s.pdf.getPage(index + 1)
      const vp = pdfPage.getViewport({ scale })
      // correct the placeholder size if this page differs from the first
      const base = pdfPage.getViewport({ scale: 1 })
      if (Math.abs(base.width - s.sizes[index].w) > 1 || Math.abs(base.height - s.sizes[index].h) > 1) {
        const pos = currentLocator()
        s.sizes[index] = { w: base.width, h: base.height }
        page.el.style.width = `${Math.floor(vp.width)}px`
        page.el.style.height = `${Math.floor(vp.height)}px`
        if (pos && index + 1 < pos.page) scrollToPos(pos.page, pos.y)
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.className = 'pdf-canvas'
      const task = pdfPage.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      page.task = task
      await task.promise
      if (s.scale !== scale) return
      page.canvas?.remove()
      page.el.prepend(canvas)
      page.canvas = canvas

      const text = document.createElement('div')
      text.className = 'textLayer'
      const tl = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport: vp })
      await tl.render()
      if (s.scale !== scale) return
      page.text?.remove()
      page.el.append(text)
      page.text = text
      page.renderedScale = scale
      drawHighlights(index)
    } catch (e) {
      if ((e as Error)?.name !== 'RenderingCancelledException') console.warn(e)
    } finally {
      page.rendering = false
      page.task = undefined
      if (s.visible.has(index) && page.renderedScale !== s.scale) renderPage(index)
    }
  }

  const releaseFarPages = (current: number) => {
    const s = st.current
    s.pages.forEach((p, i) => {
      if (Math.abs(i + 1 - current) > 10 && !s.visible.has(i) && p.canvas) {
        p.canvas.width = 0
        p.canvas.remove()
        p.text?.remove()
        p.canvas = null
        p.text = null
        p.renderedScale = 0
      }
    })
  }

  const rerenderVisible = () => {
    for (const i of st.current.visible) renderPage(i)
  }

  // ---- open ---------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    const s = st.current
    ;(async () => {
      let pdf: PdfDoc
      try {
        pdf = await openPdf(props.data.slice(0))
      } catch (e) {
        console.error(e)
        props.onError('This PDF could not be opened. It may be damaged or password-protected.')
        return
      }
      if (cancelled) return pdf.close()
      s.pdf = pdf
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
      s.sizes = Array.from({ length: pdf.numPages }, () => ({ w: first.width, h: first.height }))
      s.labels = await pdf.getPageLabels().catch(() => null)

      const container = pagesEl.current!
      s.pages = s.sizes.map((_, i) => {
        const el = document.createElement('div')
        el.className = 'pdf-page'
        el.dataset.page = String(i + 1)
        const hl = document.createElement('div')
        hl.className = 'pdf-hl-layer'
        el.append(hl)
        container.append(el)
        return { el, canvas: null, text: null, hl, renderedScale: 0, rendering: false }
      })
      layout()

      s.observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.page) - 1
            if (e.isIntersecting) {
              s.visible.add(i)
              renderPage(i)
            } else s.visible.delete(i)
          }
        },
        { root: scroller.current, rootMargin: '120% 0px' },
      )
      s.pages.forEach((p) => s.observer!.observe(p.el))

      // outline -> TOC
      const toc: TocEntry[] = []
      const walk = async (items: Awaited<ReturnType<PdfDoc['getOutline']>> | null, depth: number) => {
        for (const it of items ?? []) {
          let page = 0
          try {
            const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest
            if (Array.isArray(dest) && dest[0]) page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1
          } catch {
            /* unresolvable */
          }
          if (page) {
            toc.push({ label: it.title || 'Untitled', target: `pdf:${page}:0`, depth })
            s.outline.push({ label: it.title, page })
          }
          if (it.items?.length) await walk(it.items, depth + 1)
        }
      }
      await walk(await pdf.getOutline().catch(() => null), 0)
      s.outline.sort((a, b) => a.page - b.page)
      if (cancelled) return

      const pos = props.initialLocator && props.initialLocator !== '__start__' ? parsePosition(props.initialLocator) : null
      s.restoring = true
      requestAnimationFrame(() => {
        if (pos) scrollToPos(pos.page, pos.y)
        s.restoring = false
        report()
        propsRef.current.onReady(toc)
      })
    })()

    const onResize = () => {
      const pos = currentLocator()
      layout()
      rerenderVisible()
      if (pos) scrollToPos(pos.page, pos.y)
    }
    const ro = new ResizeObserver(() => requestAnimationFrame(onResize))
    if (scroller.current) ro.observe(scroller.current)

    return () => {
      cancelled = true
      ro.disconnect()
      s.observer?.disconnect()
      s.pages.forEach((p) => p.task?.cancel())
      s.pdf?.close()
      s.pdf = null
      s.pages = []
      pagesEl.current?.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // zoom / spread changes
  useEffect(() => {
    const pos = currentLocator()
    if (!st.current.pages.length) return
    layout()
    rerenderVisible()
    if (pos) scrollToPos(pos.page, pos.y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pdf.zoom, props.pdf.spread])

  // highlights
  useEffect(() => {
    st.current.highlights = props.highlights
    st.current.pages.forEach((_, i) => drawHighlights(i))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlights])

  // ---- selection & highlight clicks ----------------------------------------

  const onPointerUp = (e: React.PointerEvent) => {
    setTimeout(() => {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount && scroller.current?.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0)
        const parts = new Map<number, Rect[]>()
        const rects = Array.from(range.getClientRects())
        const heights = rects.map((r) => r.height).sort((a, b) => a - b)
        const median = heights[Math.floor(heights.length / 2)] || 1
        for (const r of rects) {
          if (r.width < 1 || r.height > median * 2.5) continue
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          const pageEl = st.current.pages.find((p) => {
            const b = p.el.getBoundingClientRect()
            return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom
          })?.el
          if (!pageEl) continue
          const b = pageEl.getBoundingClientRect()
          const p = Number(pageEl.dataset.page)
          const list = parts.get(p) ?? parts.set(p, []).get(p)!
          list.push([(r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height])
        }
        const hl: HlPart[] = [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([p, r]) => ({ p, r: mergeRects(r) }))
        const text = sel.toString().replace(/\s+\n/g, '\n').trim()
        if (hl.length && text) {
          const pos = currentLocator()
          const n = st.current.pages.length
          propsRef.current.onSelection({
            text,
            locator: 'pdfhl:' + JSON.stringify(hl.map((h) => ({ p: h.p, r: h.r.map((x) => x.map((v) => +v.toFixed(4)) as Rect) }))),
            rect: range.getBoundingClientRect(),
            chapter: [...st.current.outline].reverse().find((o) => o.page <= hl[0].p)?.label ?? null,
            fraction: pos ? (hl[0].p - 1 + (hl[0].r[0]?.[1] ?? 0)) / n : 0,
          })
          return
        }
      }
      propsRef.current.onSelection(null)
      // hit-test highlights
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.pdf-page')
      if (!pageEl) return
      const b = pageEl.getBoundingClientRect()
      const x = (e.clientX - b.left) / b.width
      const y = (e.clientY - b.top) / b.height
      const p = Number(pageEl.dataset.page)
      for (const a of st.current.highlights) {
        for (const part of parseHighlight(a.locator) ?? []) {
          if (part.p !== p) continue
          if (part.r.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh)) {
            propsRef.current.onHighlightClick(a.id, new DOMRect(e.clientX - 1, e.clientY - 8, 2, 16))
            return
          }
        }
      }
    }, 10)
  }

  // ---- imperative API -----------------------------------------------------

  useImperativeHandle(ref, () => ({
    goTo(locator) {
      const pos = parsePosition(locator)
      if (!pos) return
      if (pos.mark) {
        st.current.marks.set(pos.page, [pos.mark])
        drawHighlights(pos.page - 1)
      }
      scrollToPos(pos.page, pos.y)
    },
    goToFraction(f) {
      const n = st.current.pages.length
      const x = f * n
      scrollToPos(Math.floor(x) + 1, x - Math.floor(x))
    },
    next() {
      const el = scroller.current
      if (!el) return
      if (propsRef.current.pdf.zoom === 'fit-page') scrollToPos(st.current.current + (propsRef.current.pdf.spread ? 2 : 1), 0)
      else el.scrollBy({ top: el.clientHeight * 0.9 })
    },
    prev() {
      const el = scroller.current
      if (!el) return
      if (propsRef.current.pdf.zoom === 'fit-page') scrollToPos(st.current.current - (propsRef.current.pdf.spread ? 2 : 1), 0)
      else el.scrollBy({ top: -el.clientHeight * 0.9 })
    },
    async search(query, onHits, onProgress, signal) {
      const s = st.current
      const pdf = s.pdf
      if (!pdf || !query.trim()) return
      const q = query.toLowerCase()
      for (let p = 1; p <= pdf.numPages; p++) {
        if (signal.aborted) return
        const page = await pdf.getPage(p)
        const vp = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        let full = ''
        const spans: { start: number; item: { str: string; transform: number[]; width: number; height: number } }[] = []
        for (const it of content.items as { str?: string; transform: number[]; width: number; height: number; hasEOL?: boolean }[]) {
          if (typeof it.str !== 'string') continue
          spans.push({ start: full.length, item: it as { str: string; transform: number[]; width: number; height: number } })
          full += it.str + (it.hasEOL ? ' ' : '')
        }
        const lower = full.toLowerCase()
        const hits = []
        let idx = lower.indexOf(q)
        while (idx >= 0 && hits.length < 200) {
          const span = [...spans].reverse().find((sp) => sp.start <= idx)
          let rect: Rect = [0, 0, 0, 0]
          if (span) {
            const { str, transform, width, height } = span.item
            const len = Math.max(1, str.length)
            const off = idx - span.start
            const h = height || Math.abs(transform[3]) || 10
            const x = transform[4] + (width * off) / len
            const w = Math.max(4, (width * Math.min(q.length, len - off)) / len)
            const yTop = transform[5] + h
            rect = [x / vp.width, 1 - yTop / vp.height, w / vp.width, (h * 1.2) / vp.height].map((v) => +v.toFixed(4)) as Rect
          }
          hits.push({
            locator: `pdfs:${p}:${JSON.stringify(rect)}`,
            pre: full.slice(Math.max(0, idx - 40), idx),
            match: full.slice(idx, idx + q.length),
            post: full.slice(idx + q.length, idx + q.length + 60),
            label: `Page ${s.labels?.[p - 1] ?? p}`,
          })
          idx = lower.indexOf(q, idx + q.length)
        }
        if (hits.length) onHits(hits)
        if (p % 5 === 0 || p === pdf.numPages) onProgress(p / pdf.numPages)
      }
    },
    clearSearch() {
      const pages = [...st.current.marks.keys()]
      st.current.marks.clear()
      pages.forEach((p) => drawHighlights(p - 1))
    },
    clearSelection() {
      window.getSelection()?.removeAllRanges()
    },
    koPosition() {
      const n = st.current.pages.length
      if (!n) return null
      // KOReader (paged documents): progress = page number, percentage = page / pages
      return { progress: String(st.current.current), percentage: st.current.current / n }
    },
    async goToKo(progress, percentage) {
      const n = st.current.pages.length
      const page = parseInt(progress, 10)
      if (page >= 1 && page <= n) {
        scrollToPos(page, 0)
        return true
      }
      if (percentage > 0) scrollToPos(Math.max(1, Math.round(percentage * n)), 0)
      return false
    },
  }))

  return (
    <div
      ref={scroller}
      className={`pdf-scroll ${props.pdf.darkPages ? 'dark-pages' : ''}`}
      onScroll={() => requestAnimationFrame(report)}
      onPointerUp={onPointerUp}
      onPointerDown={() => props.onSelection(null)}
      tabIndex={-1}
    >
      <div ref={pagesEl} className="pdf-pages" />
    </div>
  )
})

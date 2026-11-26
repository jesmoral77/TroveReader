/**
 * Plain text, Markdown and HTML documents.
 * Locators: txt:<scrollFraction>, txthl:<start>:<end> (character offsets).
 * Highlights use the CSS Custom Highlight API, so the document DOM is never modified.
 */
import { marked } from 'marked'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '../lib/types'
import { FONT_STACKS } from './fonts'
import { THEMES, type EngineHandle, type EngineProps, type TocEntry } from './types'

function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, iframe, object, embed, link, meta, style, form').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on') || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  })
  return doc.body.innerHTML
}

function textNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

function offsetOf(root: Node, node: Node, offset: number) {
  let total = 0
  for (const t of textNodes(root)) {
    if (t === node) return total + offset
    total += t.length
  }
  // node is an element: count text before it
  const r = document.createRange()
  r.setStart(root, 0)
  r.setEnd(node, offset)
  return r.toString().length
}

function rangeFromOffsets(root: Node, start: number, end: number) {
  const range = document.createRange()
  let total = 0
  let startSet = false
  for (const t of textNodes(root)) {
    const next = total + t.length
    if (!startSet && start <= next) {
      range.setStart(t, start - total)
      startSet = true
    }
    if (startSet && end <= next) {
      range.setEnd(t, end - total)
      return range
    }
    total = next
  }
  return startSet ? range : null
}

const hasHighlightApi = () => typeof CSS !== 'undefined' && 'highlights' in CSS

export const TextEngine = forwardRef<EngineHandle, EngineProps>(function TextEngine(props, ref) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const searchRanges = useRef<Range[]>([])

  const html = useMemo(() => {
    const text = new TextDecoder().decode(props.data)
    if (props.book.format === 'md') return sanitize(marked.parse(text, { async: false }) as string)
    if (props.book.format === 'html') return sanitize(text)
    return text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
      .join('')
  }, [props.data, props.book.format])

  const report = () => {
    const el = scroller.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    const f = max > 0 ? el.scrollTop / max : 1
    const headings = [...(content.current?.querySelectorAll('h1, h2, h3') ?? [])] as HTMLElement[]
    const chapter = headings.filter((h) => h.offsetTop <= el.scrollTop + 80).pop()?.textContent?.trim() ?? null
    propsRef.current.onRelocate({ locator: `txt:${f.toFixed(4)}`, fraction: f, chapter, position: `${Math.round(f * 100)}%` })
  }

  const goTo = (locator: string) => {
    const el = scroller.current
    if (!el || !content.current) return
    if (locator.startsWith('txt:')) {
      el.scrollTop = Number(locator.slice(4)) * (el.scrollHeight - el.clientHeight)
    } else if (locator.startsWith('txthl:')) {
      const [, s, e] = locator.split(':')
      const r = rangeFromOffsets(content.current, Number(s), Number(e))
      const rect = r?.getBoundingClientRect()
      if (rect) el.scrollTop += rect.top - el.getBoundingClientRect().top - el.clientHeight * 0.3
    } else if (locator.startsWith('#')) {
      const target = content.current.querySelector<HTMLElement>(`[id="${CSS.escape(locator.slice(1))}"]`)
      if (target) el.scrollTop = target.offsetTop - 24
    }
  }

  useEffect(() => {
    // headings -> TOC
    const toc: TocEntry[] = []
    content.current?.querySelectorAll('h1, h2, h3').forEach((h, i) => {
      if (!h.id) h.id = `trove-h-${i}`
      toc.push({ label: h.textContent?.trim() || 'Section', target: `#${h.id}`, depth: Number(h.tagName[1]) - 1 })
    })
    requestAnimationFrame(() => {
      const init = props.initialLocator
      if (init && init !== '__start__') goTo(init)
      report()
      props.onReady(toc)
    })
    return () => {
      if (hasHighlightApi()) for (const c of Object.keys(HIGHLIGHT_COLORS)) CSS.highlights.delete(`trove-${c}`)
      if (hasHighlightApi()) CSS.highlights.delete('trove-search')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  // highlights
  useEffect(() => {
    if (!hasHighlightApi() || !content.current) return
    const byColor = new Map<HighlightColor, Range[]>()
    for (const a of props.highlights) {
      if (!a.locator.startsWith('txthl:')) continue
      const [, s, e] = a.locator.split(':')
      const r = rangeFromOffsets(content.current, Number(s), Number(e))
      if (r) (byColor.get(a.color) ?? byColor.set(a.color, []).get(a.color)!).push(r)
    }
    for (const c of Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]) {
      const ranges = byColor.get(c)
      if (ranges?.length) CSS.highlights.set(`trove-${c}`, new Highlight(...ranges))
      else CSS.highlights.delete(`trove-${c}`)
    }
  }, [props.highlights, html])

  const onPointerUp = (e: React.PointerEvent) => {
    setTimeout(() => {
      const root = content.current
      const sel = window.getSelection()
      if (root && sel && !sel.isCollapsed && sel.rangeCount && root.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0)
        const start = offsetOf(root, range.startContainer, range.startOffset)
        const end = offsetOf(root, range.endContainer, range.endOffset)
        const text = sel.toString().trim()
        if (text && end > start) {
          const el = scroller.current!
          propsRef.current.onSelection({
            text,
            locator: `txthl:${start}:${end}`,
            rect: range.getBoundingClientRect(),
            chapter: null,
            fraction: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
          })
          return
        }
      }
      propsRef.current.onSelection(null)
      // highlight hit test
      if (!root) return
      const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (!caret || !root.contains(caret.startContainer)) return
      const off = offsetOf(root, caret.startContainer, caret.startOffset)
      const hit = propsRef.current.highlights.find((a) => {
        const [, s, en] = a.locator.split(':')
        return a.locator.startsWith('txthl:') && off >= Number(s) && off <= Number(en)
      })
      if (hit) propsRef.current.onHighlightClick(hit.id, new DOMRect(e.clientX - 1, e.clientY - 8, 2, 16))
    }, 10)
  }

  useImperativeHandle(ref, () => ({
    goTo,
    goToFraction: (f) => goTo(`txt:${f}`),
    next: () => scroller.current?.scrollBy({ top: scroller.current.clientHeight * 0.9 }),
    prev: () => scroller.current?.scrollBy({ top: -scroller.current.clientHeight * 0.9 }),
    async search(query, onHits, onProgress) {
      const root = content.current
      if (!root || !query.trim()) return
      const full = textNodes(root).map((t) => t.data).join('')
      const lower = full.toLowerCase()
      const q = query.toLowerCase()
      const hits = []
      const ranges: Range[] = []
      let i = lower.indexOf(q)
      while (i >= 0 && hits.length < 500) {
        hits.push({
          locator: `txthl:${i}:${i + q.length}`,
          pre: full.slice(Math.max(0, i - 40), i),
          match: full.slice(i, i + q.length),
          post: full.slice(i + q.length, i + q.length + 60),
        })
        const r = rangeFromOffsets(root, i, i + q.length)
        if (r) ranges.push(r)
        i = lower.indexOf(q, i + q.length)
      }
      searchRanges.current = ranges
      if (hasHighlightApi()) CSS.highlights.set('trove-search', new Highlight(...ranges))
      onHits(hits)
      onProgress(1)
    },
    clearSearch() {
      searchRanges.current = []
      if (hasHighlightApi()) CSS.highlights.delete('trove-search')
    },
    clearSelection: () => window.getSelection()?.removeAllRanges(),
  }))

  const a = props.appearance
  const t = THEMES[a.theme]
  return (
    <div
      ref={scroller}
      className="text-scroll"
      style={{ background: t.bg, color: t.fg }}
      onScroll={() => requestAnimationFrame(report)}
      onPointerUp={onPointerUp}
      onPointerDown={() => props.onSelection(null)}
      tabIndex={-1}
    >
      <div
        ref={content}
        className={`text-doc ${props.book.format}`}
        style={{
          maxWidth: a.width,
          fontFamily: FONT_STACKS[a.font].stack ?? FONT_STACKS.serif.stack!,
          fontSize: a.fontSize,
          lineHeight: a.lineHeight,
          textAlign: a.justify ? 'justify' : 'start',
          ['--link' as string]: t.link,
          ['--muted' as string]: t.muted,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})

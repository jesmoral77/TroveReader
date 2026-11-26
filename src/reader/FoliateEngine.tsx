/**
 * EPUB / MOBI / AZW3 / FB2 / CBZ via foliate-js.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { HIGHLIGHT_COLORS, type Annotation } from '../lib/types'
import { fileName } from '../lib/metadata'
import { parseXPointer, resolveXPointer, toXPointer } from '../lib/xpointer'
import { Overlayer } from '../vendor/foliate/overlayer.js'
import type { RelocateDetail, TocItem, View } from '../vendor/foliate/view.js'
import { FONT_STACKS, fontFaceCss } from './fonts'
import { THEMES, type Appearance, type EngineHandle, type EngineProps, type TocEntry } from './types'

function bookCss(a: Appearance) {
  const t = THEMES[a.theme]
  const font = FONT_STACKS[a.font].stack
  return `
    ${fontFaceCss()}
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${a.theme === 'sepia' || a.theme === 'light' ? 'light' : 'dark'};
      background: ${t.bg} !important;
      color: ${t.fg} !important;
      font-size: ${a.fontSize}px !important;
    }
    body { background: transparent !important; color: inherit !important; ${font ? `font-family: ${font} !important;` : ''} }
    ${font ? `p, li, blockquote, dd, div, span, td { font-family: inherit !important; }` : ''}
    * { color: inherit !important; border-color: ${t.muted} !important; }
    a:link, a:visited { color: ${t.link} !important; }
    p, li, blockquote, dd {
      line-height: ${a.lineHeight} !important;
      text-align: ${a.justify ? 'justify' : 'start'};
      hyphens: auto;
      -webkit-hyphens: auto;
      widows: 2;
      orphans: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; height: auto; ${a.theme === 'dark' || a.theme === 'black' ? 'filter: brightness(0.92);' : ''} }
    ::selection { background: ${a.theme === 'dark' || a.theme === 'black' ? 'rgba(140,170,220,.45)' : 'rgba(70,120,220,.3)'}; }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
  `
}

function flattenToc(items: TocItem[] | undefined, depth = 0, out: TocEntry[] = []) {
  for (const it of items ?? []) {
    out.push({ label: (it.label ?? '').trim() || 'Untitled', target: it.href, depth })
    if (it.subitems?.length) flattenToc(it.subitems, depth + 1, out)
  }
  return out
}

export const FoliateEngine = forwardRef<EngineHandle, EngineProps>(function FoliateEngine(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const highlightsRef = useRef<Map<string, Annotation>>(new Map())
  const lastLoc = useRef<RelocateDetail | null>(null)

  // open the book once
  useEffect(() => {
    let cancelled = false
    let view: View | null = null
    ;(async () => {
      await import('../vendor/foliate/view.js')
      if (cancelled || !host.current) return
      view = document.createElement('foliate-view') as View
      view.className = 'foliate-view'
      host.current.append(view)
      viewRef.current = view
      try {
        await view.open(new File([props.data], fileName(props.book.path)))
      } catch (e) {
        console.error(e)
        props.onError('This file could not be opened. It may be damaged or DRM-protected.')
        return
      }
      if (cancelled) return
      applyAppearance(view, propsRef.current.appearance)

      view.addEventListener('relocate', (e: Event) => {
        const d = (e as CustomEvent<RelocateDetail>).detail
        lastLoc.current = d
        const loc = d.location
        const position = d.pageItem?.label
          ? `Page ${d.pageItem.label}`
          : loc
            ? `Loc ${loc.current + 1} of ${loc.total}`
            : ''
        propsRef.current.onRelocate({ locator: d.cfi, fraction: Number.isFinite(d.fraction) ? d.fraction : 0, chapter: d.tocItem?.label?.trim() ?? null, position })
      })

      view.addEventListener('load', (e: Event) => {
        const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail
        doc.addEventListener('keydown', (ev) => propsRef.current.onKey(ev))
        const checkSelection = () =>
          setTimeout(() => {
            const sel = doc.getSelection()
            if (!sel || sel.isCollapsed || !sel.rangeCount) return propsRef.current.onSelection(null)
            const range = sel.getRangeAt(0)
            const text = sel.toString().trim()
            if (!text) return propsRef.current.onSelection(null)
            const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
            const r = range.getBoundingClientRect()
            const rect = new DOMRect((frame?.left ?? 0) + r.left, (frame?.top ?? 0) + r.top, r.width, r.height)
            propsRef.current.onSelection({
              text,
              locator: view!.getCFI(index, range),
              rect,
              chapter: lastLoc.current?.tocItem?.label?.trim() ?? null,
              fraction: lastLoc.current?.fraction ?? 0,
            })
          }, 10)
        doc.addEventListener('pointerup', checkSelection)
        doc.addEventListener('keyup', (ev) => ev.shiftKey && checkSelection())
        doc.addEventListener('pointerdown', () => {
          propsRef.current.onSelection(null)
          // let the reader shell know a click started inside the book (iframes don't bubble)
          host.current?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        })
      })

      view.addEventListener('create-overlay', async (e: Event) => {
        const { index } = (e as CustomEvent<{ index: number }>).detail
        for (const a of highlightsRef.current.values()) {
          try {
            const resolved = (view as unknown as { resolveNavigation(t: string): { index: number } }).resolveNavigation(a.locator)
            if (resolved?.index === index) view!.addAnnotation({ value: a.locator })
          } catch {
            /* unresolvable CFI */
          }
        }
      })
      view.addEventListener('draw-annotation', (e: Event) => {
        const { draw, annotation } = (e as CustomEvent).detail
        const a = highlightsRef.current.get(annotation.value)
        draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[a?.color ?? 'yellow'] })
      })
      view.addEventListener('show-annotation', (e: Event) => {
        const { value, range } = (e as CustomEvent<{ value: string; range: Range }>).detail
        const a = highlightsRef.current.get(value)
        if (!a) return
        const doc = range.startContainer.ownerDocument
        const frame = doc?.defaultView?.frameElement?.getBoundingClientRect()
        const r = range.getBoundingClientRect()
        propsRef.current.onHighlightClick(a.id, new DOMRect((frame?.left ?? 0) + r.left, (frame?.top ?? 0) + r.top, r.width, r.height))
      })

      const toc = flattenToc(view.book.toc)
      const initial = props.initialLocator
      if (initial && initial !== '__start__') {
        await view.init({ lastLocation: initial })
      } else {
        await view.init({ showTextStart: initial !== '__start__' ? true : false })
        if (initial === '__start__') await view.goTo(0)
      }
      propsRef.current.onReady(toc)
    })()
    return () => {
      cancelled = true
      try {
        view?.close?.()
      } catch {
        /* ignore */
      }
      view?.remove()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // appearance changes
  useEffect(() => {
    if (viewRef.current?.renderer) applyAppearance(viewRef.current, props.appearance)
  }, [props.appearance])

  // highlight sync
  useEffect(() => {
    const view = viewRef.current
    const next = new Map(props.highlights.map((a) => [a.locator, a]))
    const prev = highlightsRef.current
    highlightsRef.current = next
    if (!view?.renderer) return
    for (const loc of prev.keys()) if (!next.has(loc)) view.deleteAnnotation({ value: loc }).catch(() => {})
    for (const [loc, a] of next) {
      const old = prev.get(loc)
      if (!old || old.color !== a.color) view.addAnnotation({ value: loc }).catch(() => {})
    }
  }, [props.highlights])

  useImperativeHandle(ref, () => ({
    goTo: (locator) => void viewRef.current?.goTo(locator),
    goToFraction: (f) => void viewRef.current?.goToFraction(f),
    next: () => void viewRef.current?.goRight(),
    prev: () => void viewRef.current?.goLeft(),
    async search(query, onHits, onProgress, signal) {
      const view = viewRef.current
      if (!view) return
      for await (const r of view.search({ query })) {
        if (signal.aborted) break
        if (r === 'done') break
        if ('progress' in r) onProgress(r.progress)
        else if ('subitems' in r)
          onHits(r.subitems.map((s) => ({ locator: s.cfi, pre: s.excerpt.pre, match: s.excerpt.match, post: s.excerpt.post, label: r.label })))
      }
    },
    clearSearch: () => viewRef.current?.clearSearch(),
    clearSelection: () => viewRef.current?.deselect(),
    showTarget: (locator) => void (viewRef.current as unknown as { select(t: string): Promise<void> })?.select(locator),
    koPosition() {
      const view = viewRef.current
      const loc = lastLoc.current as (RelocateDetail & { range?: Range }) | null
      if (!view || !loc) return null
      const index = sectionIndex(view, loc.cfi)
      if (index == null) return null
      if (props.book.format === 'cbz') {
        // KOReader opens comics as paged documents: progress is the page number
        const total = view.book.sections.length
        return { progress: String(index + 1), percentage: (index + 1) / total }
      }
      if (!loc.range) return null
      return { progress: toXPointer(index, loc.range.startContainer, loc.range.startOffset), percentage: loc.fraction ?? 0 }
    },
    async goToKo(progress, percentage) {
      const view = viewRef.current
      if (!view) return false
      if (props.book.format === 'cbz') {
        const page = parseInt(progress, 10)
        if (page >= 1 && page <= view.book.sections.length) {
          await view.goTo(page - 1)
          return true
        }
      } else {
        const parsed = parseXPointer(progress)
        const section = parsed ? view.book.sections[parsed.section] : null
        if (parsed && section?.createDocument) {
          try {
            const doc = await section.createDocument()
            const { node, offset, exact } = resolveXPointer(doc, parsed)
            const range = doc.createRange()
            range.setStart(node, offset)
            range.collapse(true)
            await view.goTo(view.getCFI(parsed.section, range))
            return exact
          } catch (e) {
            console.warn('XPointer conversion failed', progress, e)
          }
        }
      }
      if (percentage > 0) await view.goToFraction(percentage)
      return false
    },
  }))

  return <div ref={host} className="foliate-host" style={{ background: THEMES[props.appearance.theme].bg }} />
})

function sectionIndex(view: View, cfi: string): number | null {
  try {
    const r = (view as unknown as { resolveNavigation(t: string): { index: number } }).resolveNavigation(cfi)
    return typeof r?.index === 'number' ? r.index : null
  } catch {
    return null
  }
}

function applyAppearance(view: View, a: Appearance) {
  const r = view.renderer
  r.setAttribute('flow', a.flow)
  r.setAttribute('max-inline-size', `${a.width}px`)
  r.setAttribute('max-column-count', String(a.columns))
  r.setAttribute('gap', '7%')
  r.setAttribute('margin', '56px')
  r.setAttribute('animated', '')
  r.setStyles?.(bookCss(a))
  view.style.setProperty('--trove-bg', THEMES[a.theme].bg)
}

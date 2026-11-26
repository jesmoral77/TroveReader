/**
 * Conversion between KOReader (CREngine) XPointers and DOM positions in an EPUB section.
 *
 *   /body/DocFragment[12]/body/div/p[5]/text().23
 *
 * DocFragment[N] is the Nth spine item (1-based). Below it the path mirrors the
 * section's XHTML from <body> down: element steps are "name[k]" where k counts
 * siblings with the same tag name (the [k] is omitted when there is only one,
 * though newer KOReader versions always write it), and a final "text()[k].offset"
 * addresses a character in the k-th text node. CREngine drops whitespace-only
 * text nodes, so those are skipped when counting here.
 */

const isBlankText = (n: Node) => n.nodeType === Node.TEXT_NODE && !/\S/.test(n.nodeValue ?? '')
const isText = (n: Node) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE
const nameOf = (el: Element) => el.localName.toLowerCase()

interface Step {
  kind: 'element' | 'text'
  name: string
  index: number
}

export interface ParsedXPointer {
  /** 0-based spine index */
  section: number
  steps: Step[]
  offset: number | null
}

export function parseXPointer(xp: string): ParsedXPointer | null {
  const m = xp.trim().match(/^\/body\/DocFragment(?:\[(\d+)\])?(\/.*)?$/)
  if (!m) return null
  const section = Number(m[1] ?? 1) - 1
  let rest = m[2] ?? ''
  let offset: number | null = null
  const point = rest.match(/\.(\d+)$/)
  if (point) {
    offset = Number(point[1])
    rest = rest.slice(0, -point[0].length)
  }
  const steps: Step[] = []
  for (const part of rest.split('/').filter(Boolean)) {
    const s = part.match(/^([\w:-]+)(\(\))?(?:\[(\d+)\])?$/)
    if (!s) return null
    steps.push({ kind: s[2] ? 'text' : 'element', name: s[1].toLowerCase(), index: Number(s[3] ?? 1) })
  }
  return { section, steps, offset }
}

/** Resolves a parsed XPointer in a section document. Falls back to the deepest node it could reach. */
export function resolveXPointer(doc: Document, p: ParsedXPointer): { node: Node; offset: number; exact: boolean } {
  let node: Node = doc.body ?? doc.documentElement
  let exact = true
  const steps = p.steps[0]?.kind === 'element' && p.steps[0].name === 'body' ? p.steps.slice(1) : p.steps
  for (const step of steps) {
    const kids = Array.from(node.childNodes)
    const match =
      step.kind === 'element'
        ? kids.filter((k): k is Element => k.nodeType === Node.ELEMENT_NODE && nameOf(k as Element) === step.name)
        : kids.filter((k) => isText(k) && !isBlankText(k))
    const next = match[step.index - 1]
    if (!next) {
      exact = false
      break
    }
    node = next
  }
  if (isText(node)) {
    const len = node.nodeValue?.length ?? 0
    // CREngine trims leading whitespace that the browser keeps
    const lead = (node.nodeValue ?? '').match(/^\s*/)?.[0].length ?? 0
    return { node, offset: Math.min(len, (p.offset ?? 0) + (exact ? lead : 0)), exact }
  }
  return { node, offset: 0, exact }
}

/** Builds a KOReader XPointer for a DOM position inside a section document. */
export function toXPointer(sectionIndex: number, node: Node, offset: number): string {
  // normalise to a text node or element we can describe
  if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[offset]) {
    node = node.childNodes[offset]
    offset = 0
  }
  if (isText(node) && isBlankText(node)) {
    node = node.parentNode ?? node
    offset = 0
  }
  let path = ''
  let cur: Node | null = node
  if (isText(cur)) {
    const parent: Node = cur.parentNode!
    const texts = Array.from(parent.childNodes).filter((k) => isText(k) && !isBlankText(k))
    const idx = texts.indexOf(cur as ChildNode) + 1
    const lead = (cur.nodeValue ?? '').match(/^\s*/)?.[0].length ?? 0
    path = `/text()${texts.length > 1 ? `[${idx}]` : ''}.${Math.max(0, offset - lead)}`
    cur = parent
  }
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    const el = cur as Element
    if (nameOf(el) === 'body' || !el.parentElement) break
    const same = Array.from(el.parentElement.children).filter((k) => nameOf(k) === nameOf(el))
    path = `/${nameOf(el)}${same.length > 1 ? `[${same.indexOf(el) + 1}]` : ''}${path}`
    cur = el.parentElement
  }
  return `/body/DocFragment[${sectionIndex + 1}]/body${path}`
}

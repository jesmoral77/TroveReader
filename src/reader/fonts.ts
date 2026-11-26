// Reading fonts are bundled so they work offline and inside book iframes.
import literata400 from '@fontsource/literata/files/literata-latin-400-normal.woff2?url'
import literata400i from '@fontsource/literata/files/literata-latin-400-italic.woff2?url'
import literata700 from '@fontsource/literata/files/literata-latin-700-normal.woff2?url'
import literata700i from '@fontsource/literata/files/literata-latin-700-italic.woff2?url'
import plex400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'
import plex600 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url'
import type { FontKey } from './types'

const abs = (u: string) => new URL(u, window.location.href).href

export function fontFaceCss() {
  const face = (family: string, url: string, weight: number, style = 'normal') =>
    `@font-face{font-family:"${family}";src:url("${abs(url)}") format("woff2");font-weight:${weight};font-style:${style};font-display:swap}`
  return [
    face('Trove Literata', literata400, 400),
    face('Trove Literata', literata400i, 400, 'italic'),
    face('Trove Literata', literata700, 700),
    face('Trove Literata', literata700i, 700, 'italic'),
    face('Trove Mono', plex400, 400),
    face('Trove Mono', plex600, 700),
  ].join('\n')
}

export const FONT_STACKS: Record<FontKey, { label: string; stack: string | null }> = {
  serif: { label: 'Serif', stack: '"Trove Literata", Georgia, "Cambria", serif' },
  sans: { label: 'Sans', stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  mono: { label: 'Mono', stack: '"Trove Mono", "Cascadia Mono", Consolas, monospace' },
  publisher: { label: 'Original', stack: null },
}

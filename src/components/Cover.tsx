import { memo, useState } from 'react'
import { api } from '../lib/backend'
import type { Book } from '../lib/types'

// ---------------------------------------------------------------------------
// Deterministic randomness so a file always gets the same generated cover
// ---------------------------------------------------------------------------

function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Palette {
  bg: string
  fg: string
  accent: string
  label: string
}

const PALETTES: Palette[] = [
  { bg: '#2f5d4a', fg: '#ece6d6', accent: '#d9b44a', label: '#e9e2d0' },
  { bg: '#22377a', fg: '#ece6d6', accent: '#e0b84a', label: '#e9e2d0' },
  { bg: '#a89bd8', fg: '#2b2440', accent: '#3b3060', label: '#ece6f3' },
  { bg: '#a9c1e0', fg: '#26324a', accent: '#34466b', label: '#eef1f5' },
  { bg: '#4b2f52', fg: '#e5dcea', accent: '#c9a2d6', label: '#e9e2d0' },
  { bg: '#aab48a', fg: '#2e3324', accent: '#2f5d4a', label: '#eeeedf' },
  { bg: '#d9673a', fg: '#fbeee6', accent: '#f6d3c2', label: '#f3e6dc' },
  { bg: '#eaa596', fg: '#3b2420', accent: '#5a2e28', label: '#f6e8e2' },
  { bg: '#3a4350', fg: '#dfe5ec', accent: '#e07a5f', label: '#e7e9ec' },
  { bg: '#d8cdb4', fg: '#3a3328', accent: '#2f5d4a', label: '#efe9dc' },
  { bg: '#7a4a2c', fg: '#f0e0cc', accent: '#e8c79a', label: '#f0e4d2' },
  { bg: '#2c6b6b', fg: '#e3efe9', accent: '#f0c56a', label: '#e6efe9' },
]

type Motif = (r: () => number, p: Palette) => JSX.Element

const MOTIFS: Motif[] = [
  // halftone sun
  (_r, p) => {
    const dots = []
    for (let y = 0; y < 13; y++)
      for (let x = 0; x < 13; x++) {
        const d = Math.hypot(x - 6, y - 6)
        if (d > 6.4) continue
        dots.push(<circle key={`${x}-${y}`} cx={8 + x * 7} cy={8 + y * 7} r={Math.max(0.4, 2.6 - d * 0.36)} fill={p.accent} />)
      }
    return <>{dots}</>
  },
  // rising bars
  (r, p) => (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const h = 18 + i * 14 + r() * 10
        return <rect key={i} x={10 + i * 17} y={95 - h} width={12} height={h} fill={i === 4 ? p.accent : p.fg} opacity={i === 4 ? 1 : 0.55 + i * 0.1} />
      })}
    </>
  ),
  // stacked lines
  (r, p) => (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={6} y={8 + i * 12} width={88 - i * 9 - r() * 10} height={5} rx={1} fill={i === 6 ? p.accent : p.fg} opacity={0.85} />
      ))}
    </>
  ),
  // waves
  (r, p) => (
    <>
      <circle cx={30 + r() * 30} cy={22} r={10} fill={p.accent} />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M0 ${50 + i * 15} C 25 ${38 + i * 15}, 45 ${64 + i * 15}, 70 ${50 + i * 15} S 95 ${42 + i * 15}, 100 ${48 + i * 15} L100 100 L0 100Z`}
          fill={p.fg}
          opacity={0.25 + i * 0.25}
        />
      ))}
    </>
  ),
  // ring grid
  (r, p) => (
    <>
      {Array.from({ length: 12 }, (_, i) => {
        const x = 15 + (i % 4) * 23
        const y = 15 + Math.floor(i / 4) * 25
        const open = r() > 0.6
        return open ? (
          <path key={i} d={`M ${x - 8} ${y} A 8 8 0 1 1 ${x} ${y + 8}`} fill="none" stroke={p.fg} strokeWidth={3} />
        ) : (
          <circle key={i} cx={x} cy={y} r={8} fill="none" stroke={p.fg} strokeWidth={3} />
        )
      })}
    </>
  ),
  // squares grid
  (r, p) => (
    <>
      {Array.from({ length: 15 }, (_, i) => (
        <rect
          key={i}
          x={6 + (i % 5) * 18.5}
          y={10 + Math.floor(i / 5) * 22}
          width={14}
          height={14}
          rx={1.5}
          fill={r() > 0.7 ? p.label : 'none'}
          stroke={p.label}
          strokeWidth={2}
        />
      ))}
    </>
  ),
  // shapes
  (r, p) => (
    <>
      <rect x={8} y={10} width={38} height={44} fill={p.fg} opacity={0.85} />
      <circle cx={68} cy={34} r={18} fill={p.accent} />
      <path d={`M 46 96 A 40 40 0 0 1 86 56 L 86 96 Z`} fill={p.fg} opacity={0.6} />
      <circle cx={24 + r() * 10} cy={76} r={10} fill={p.accent} opacity={0.9} />
    </>
  ),
  // concentric
  (_r, p) => (
    <>
      {[44, 36, 28, 20, 12, 5].map((rad, i) => (
        <circle key={i} cx={50} cy={50} r={rad} fill="none" stroke={i === 5 ? p.accent : p.fg} strokeWidth={i === 5 ? 4 : 1.4} opacity={0.8} />
      ))}
    </>
  ),
  // constellation wave
  (r, p) => (
    <>
      {Array.from({ length: 48 }, (_, i) => {
        const x = 4 + (i % 24) * 4
        const row = Math.floor(i / 24)
        const y = 50 + Math.sin(x / 9 + row * 1.7) * (14 + row * 8) + (r() - 0.5) * 5
        return <circle key={i} cx={x} cy={y} r={1.2 + r() * 1.2} fill={row ? p.accent : p.fg} />
      })}
    </>
  ),
]

type Style = 'notebook' | 'paper' | 'cloth'

function styleFor(book: Book): Style {
  switch (book.type) {
    case 'summary':
    case 'course':
    case 'talk':
    case 'conversation':
      return 'notebook'
    case 'book':
    case 'comic':
      return 'cloth'
    default:
      return book.format === 'pdf' || book.format === 'md' || book.format === 'txt' || book.format === 'html' ? 'paper' : 'cloth'
  }
}

export const GeneratedCover = memo(function GeneratedCover({ book }: { book: Book }) {
  // seeded from the file fingerprint so a file keeps its cover across rescans and re-adds
  const seed = hashString(book.hash ?? book.path)
  const r = rng(seed)
  const palette = PALETTES[Math.floor(r() * PALETTES.length)]
  const motif = MOTIFS[Math.floor(r() * MOTIFS.length)]
  const style = styleFor(book)
  const author = book.authors[0]
  const art = (
    <svg className="gc-art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {motif(r, palette)}
    </svg>
  )

  if (style === 'paper') {
    const paperPalette = { ...palette, fg: '#3a3630', label: palette.bg }
    return (
      <div className="gcover gc-paper">
        <div className="gc-fold" />
        {author && (
          <div className="gc-kicker">
            <i style={{ background: palette.bg }} />
            {author}
          </div>
        )}
        <div className="gc-title">{book.title}</div>
        <div className="gc-rule" style={{ background: palette.bg }} />
        <div className="gc-body">
          <div className="gc-lines">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} style={{ width: `${60 + ((seed >> i) & 31)}%` }} />
            ))}
          </div>
          <svg className="gc-art small" viewBox="0 0 100 100" aria-hidden>
            {MOTIFS[(seed >>> 3) % MOTIFS.length](rng(seed + 1), paperPalette)}
          </svg>
        </div>
        <div className="gc-lines bottom">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} style={{ width: `${55 + ((seed >> (i + 4)) & 31)}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (style === 'notebook') {
    return (
      <div className="gcover gc-notebook" style={{ background: palette.bg, color: palette.fg }}>
        <div className="gc-spiral" />
        <div className="gc-nb-art">{art}</div>
        <div className="gc-label" style={{ background: palette.label }}>
          <div className="gc-label-title">{book.title}</div>
          {author && <div className="gc-label-sub">{author}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="gcover gc-cloth" style={{ background: palette.bg, color: palette.fg }}>
      <div className="gc-cloth-art">{art}</div>
      <div className="gc-cloth-title">{book.title}</div>
      {author && <div className="gc-cloth-author">{author}</div>}
    </div>
  )
})

export function Cover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false)
  const useFile = book.coverMode === 'file' && book.coverPath && !failed
  return (
    <div className={`cover ${book.missing ? 'is-missing' : ''}`}>
      {useFile ? (
        <img
          className="cover-img"
          src={api().coverUrl(book.coverPath!)}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <GeneratedCover book={book} />
      )}
    </div>
  )
}

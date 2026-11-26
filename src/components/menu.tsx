import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export interface MenuItem {
  label?: string
  hint?: string
  onClick?: () => void
  submenu?: MenuItem[]
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[] | null
}

export const useMenu = create<MenuState>(() => ({ x: 0, y: 0, items: null }))

export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) {
  e.preventDefault?.()
  useMenu.setState({ x: e.clientX, y: e.clientY, items })
}

export function showMenuAt(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect()
  useMenu.setState({ x: r.left, y: r.bottom + 4, items })
}

const close = () => useMenu.setState({ items: null })

function MenuList({ items, x, y, nested }: { items: MenuItem[]; x: number; y: number; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 8) nx = nested ? x - r.width - 200 : window.innerWidth - r.width - 8
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ x: Math.max(8, nx), y: ny })
  }, [x, y, nested])

  return (
    <>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              className={`menu-item ${item.danger ? 'danger' : ''} ${open?.index === i ? 'open' : ''}`}
              disabled={item.disabled}
              onMouseEnter={(e) => {
                if (item.submenu) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setOpen({ index: i, x: r.right + 2, y: r.top - 5 })
                } else setOpen(null)
              }}
              onClick={() => {
                if (item.submenu) return
                close()
                item.onClick?.()
              }}
            >
              <span className="menu-check">{item.checked ? '✓' : ''}</span>
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
              {item.submenu && <span className="menu-arrow">›</span>}
            </button>
          ),
        )}
      </div>
      {open && items[open.index]?.submenu && (
        <MenuList items={items[open.index].submenu!} x={open.x} y={open.y} nested />
      )}
    </>
  )
}

export function ContextMenuHost() {
  const { items, x, y } = useMenu()
  useEffect(() => {
    if (!items) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [items])
  if (!items) return null
  return (
    <div className="menu-layer" onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => { e.preventDefault(); close() }}>
      <MenuList items={items} x={x} y={y} />
    </div>
  )
}

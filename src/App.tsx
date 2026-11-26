import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { DragLayer } from './components/drag'
import { EditBookDialog, SettingsDialog, ShelfDialog, Toast } from './components/Dialogs'
import { LibraryView } from './components/LibraryView'
import { ContextMenuHost } from './components/menu'
import { Sidebar } from './components/Sidebar'
import { api, initBackend } from './lib/backend'
import { migrate } from './lib/db'
import { loadKoSettings } from './lib/kosync'
import { addPaths, processMetadataQueue, rescanAll, startWatching } from './lib/library'
import { loadPrefs, openBook, reloadLibrary, useStore } from './lib/store'
import { ReaderView } from './reader/ReaderView'

async function openPaths(paths: string[]) {
  const ids = await addPaths(paths)
  if (ids.length === 1) openBook(ids[0])
}

export function App() {
  const ready = useStore((s) => s.ready)
  const reader = useStore((s) => s.reader)
  const [fatal, setFatal] = useState<string | null>(null)
  const [dropHover, setDropHover] = useState(false)

  useEffect(() => {
    const cleanups: (() => void)[] = []
    ;(async () => {
      try {
        const b = await initBackend()
        await migrate()
        await reloadLibrary()
        await loadPrefs()
        await loadKoSettings()
        useStore.setState({ ready: true })
        if (!b.isDesktop && new URLSearchParams(location.search).has('demo')) {
          const { seedDemo } = await import('./lib/demoSeed')
          await seedDemo()
        }
        await startWatching()
        rescanAll().then(processMetadataQueue)
        const launch = await b.launchFiles()
        if (launch.length) openPaths(launch)
        cleanups.push(await b.onOpenFiles(openPaths))
        cleanups.push(await b.onFileDrop(openPaths, setDropHover))
      } catch (e) {
        console.error(e)
        setFatal(String(e))
      }
    })()
    return () => cleanups.forEach((c) => c())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useStore.setState((s) => ({ paletteOpen: !s.paletteOpen }))
      } else if (ctrl && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        api()
          .pickFiles()
          .then((p) => {
            if (p.length) openPaths(p)
          })
      }
    }
    window.addEventListener('keydown', onKey)
    // Block the browser's own context menu everywhere except text fields
    const onCtx = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault()
    }
    window.addEventListener('contextmenu', onCtx)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onCtx)
    }
  }, [])

  if (fatal) return <div className="fatal">Trove couldn’t start: {fatal}</div>
  if (!ready) return <div className="boot">Trove</div>

  return (
    <div className="app">
      <Sidebar />
      {reader ? <ReaderView key={reader.bookId} /> : <LibraryView />}
      <CommandPalette />
      <ShelfDialog />
      <EditBookDialog />
      <SettingsDialog />
      <ContextMenuHost />
      <DragLayer />
      <Toast />
      {dropHover && <div className="drop-hint">Drop to add to your library</div>}
    </div>
  )
}

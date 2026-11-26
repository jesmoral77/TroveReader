import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/backend'
import { addPaths, removeFolder, rescanAll } from '../lib/library'
import { flattenShelves, shelfPath } from '../lib/selectors'
import { addToShelf, createShelf, removeFromShelf, renameShelf, updateBooks, useStore } from '../lib/store'
import { BOOK_TYPES, type BookType } from '../lib/types'
import { KoSyncSettings } from './KoSyncSettings'

const NO_LINKS: number[] = []

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function ShelfDialog() {
  const dlg = useStore((s) => s.shelfDialog)
  const shelves = useStore((s) => s.shelves)
  const selection = useStore((s) => s.selection)
  const [name, setName] = useState('')
  useEffect(() => {
    if (dlg?.mode === 'rename') setName(shelves.find((s) => s.id === dlg.id)?.name ?? '')
    else setName('')
  }, [dlg])
  if (!dlg) return null
  const close = () => useStore.setState({ shelfDialog: null })
  const parent = dlg.mode === 'create' && dlg.parentId != null ? shelves.find((s) => s.id === dlg.parentId) : null
  const title = dlg.mode === 'rename' ? 'Rename shelf' : parent ? `New shelf in ${parent.name}` : 'New shelf group'
  const submit = async () => {
    const n = name.trim()
    if (!n) return
    if (dlg.mode === 'rename') await renameShelf(dlg.id, n)
    else {
      const id = await createShelf(dlg.parentId, n)
      if (selection.length && dlg.parentId != null) await addToShelf(selection, id)
    }
    close()
  }
  return (
    <Modal title={title} onClose={close}>
      {dlg.mode === 'create' && dlg.parentId == null && (
        <p className="muted small">Groups sit at the top of the Shelves section, like Projects, Topics, Teachers or Areas.</p>
      )}
      <input
        className="input"
        autoFocus
        value={name}
        placeholder="Name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {dlg.mode === 'create' && dlg.parentId != null && selection.length > 0 && (
        <p className="muted small">The {selection.length} selected item(s) will be added to it.</p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={!name.trim()}>
          {dlg.mode === 'rename' ? 'Rename' : 'Create'}
        </button>
      </div>
    </Modal>
  )
}

export function EditBookDialog() {
  const id = useStore((s) => s.editBookId)
  const book = useStore((s) => (id ? s.books[id] : null))
  const shelves = useStore((s) => s.shelves)
  const links = useStore((s) => (id ? s.links[id] : undefined)) ?? NO_LINKS
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [type, setTypeValue] = useState<BookType>('unsorted')

  useEffect(() => {
    if (book) {
      setTitle(book.title)
      setAuthors(book.authors.join('; '))
      setTypeValue(book.type)
    }
  }, [id])

  if (!book) return null
  const close = () => useStore.setState({ editBookId: null })
  const save = async () => {
    const authorList = authors
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean)
    const patch = { title: title.trim() || book.title, authors: authorList, type }
    await updateBooks([book.id], patch, { edited: 1, ...(type !== book.type ? { type_auto: 0 } : {}) })
    close()
  }
  return (
    <Modal title="Edit details" onClose={close} wide>
      <div className="form">
        <label>
          Title
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Authors <span className="muted small">separate with ;</span>
          <input className="input" value={authors} onChange={(e) => setAuthors(e.target.value)} />
        </label>
        <label>
          Type
          <select className="input" value={type} onChange={(e) => setTypeValue(e.target.value as BookType)}>
            {BOOK_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.singular}
              </option>
            ))}
          </select>
        </label>
        <div className="form-shelves">
          <div className="label">Shelves</div>
          <div className="shelf-checks">
            {flattenShelves(shelves).map((s) => (
              <label key={s.id} style={{ paddingLeft: (shelfPath(shelves, s.id).length - 1) * 16 }}>
                <input
                  type="checkbox"
                  checked={links.includes(s.id)}
                  onChange={(e) => (e.target.checked ? addToShelf([book.id], s.id) : removeFromShelf([book.id], s.id))}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div className="file-info muted small">
          <div title={book.path}>{book.path}</div>
          <div>
            {book.format.toUpperCase()} · {(book.size / 1048576).toFixed(1)} MB{book.pages ? ` · ${book.pages} pages` : ''}
            {book.publisher ? ` · ${book.publisher}` : ''}
            {book.year ? ` · ${book.year}` : ''}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  )
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const folders = useStore((s) => s.folders)
  const books = useStore((s) => s.books)
  if (!open) return null
  const close = () => useStore.setState({ settingsOpen: false })
  const countIn = (fid: number) => Object.values(books).filter((b) => b.folderId === fid).length
  return (
    <Modal title="Settings" onClose={close} wide>
      <h4 className="settings-h">Library folders</h4>
      <p className="muted small">
        Trove indexes these folders in place. Files are never moved or copied, and changes on disk are picked up automatically.
      </p>
      <div className="folder-list">
        {folders.map((f) => (
          <div key={f.id} className="folder-row">
            <span className="folder-path" title={f.path}>
              {f.path}
            </span>
            <span className="muted small">{countIn(f.id)} items</span>
            <button
              className="btn sm"
              onClick={async () => {
                if (await api().confirm(`Stop watching ${f.path}? Its books (and your progress and notes for them) are removed from Trove. Files on disk are not touched.`))
                  removeFolder(f.id, true)
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!folders.length && <div className="muted">No folders yet.</div>}
      </div>
      <div className="modal-actions left">
        <button
          className="btn"
          onClick={async () => {
            const p = await api().pickFolder()
            if (p) addPaths([p])
          }}
        >
          Add folder…
        </button>
        <button className="btn" onClick={() => rescanAll()}>
          Rescan now
        </button>
      </div>
      <h4 className="settings-h">KOReader sync</h4>
      <KoSyncSettings />
      <div className="modal-actions">
        <button className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  )
}

export function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null
  return <div className="toast">{toast}</div>
}

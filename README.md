# Trove

A Windows library and reader for PDFs, EPUBs and other e-book formats. Built with Tauri 2, React and Rust.

## Build and run on Windows

**One-time setup:**

1. Install the **Microsoft C++ Build Tools** (Visual Studio Installer › "Desktop development with C++").
2. Install **Rust** from https://rustup.rs (use the default `stable-msvc` toolchain).
3. Install **Node.js 20 or newer** from https://nodejs.org.
4. WebView2 is already on Windows 10 and 11.

Full prerequisites: https://v2.tauri.app/start/prerequisites/

**Then, in this folder:**

```powershell
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # make installers in src-tauri\target\release\bundle\ (NSIS .exe and .msi)
```

The first Rust build takes a few minutes. Later builds are much faster.

**UI work without Rust:** `npm run dev` runs the whole interface in a normal browser. It uses an in-memory database and the demo files in `demo/`. Open http://localhost:1420/?demo to load a sample library with shelves, progress and a highlight. Regenerate the samples with `npm run demo` (needs Python with `reportlab` and `Pillow`).

## Features

**Library**
- Folders are indexed in place. Files are never copied or moved. Library folders are watched, so new, changed and deleted files are picked up automatically.
- Files are fingerprinted (size plus the first and last 64 KB). If a file is renamed or moved inside your library, it keeps its progress, shelves and highlights. Files that disappear appear under **Missing Files**, where **Locate file…** reconnects them.
- Formats: PDF, EPUB, MOBI, AZW3, FB2, CBZ, Markdown, TXT, HTML. DRM-protected files are not supported.
- Metadata (title, authors, pages, publisher, year) and covers are read in the background. PDFs whose first page looks like artwork use it as the cover. Everything else gets a generated cover (notebook, paper or cloth hardcover) that stays the same for each file.
- Type tabs: Books, Summaries, Articles, Papers, Course Materials, Conversations, Talks, Comics, Unsorted. Types are guessed automatically and can be changed per item.

**Sidebar**
- Library: Inbox (items not on any shelf), All Books, Currently Reading, Recent, Starred, Finished.
- Notes: Bookmarks and Highlights from every book, filterable and exportable to Markdown.
- Shelves: nested shelf groups. Projects and Topics are created by default; add your own groups (Teachers, Areas…) with **+**. An item can be on any number of shelves.
- Authors: built automatically from metadata.
- Every row shows a count. Drag books onto a shelf to file them. Right-click a shelf to rename it, add a sub-shelf or delete it. The sidebar can be resized by dragging its edge.

**Shelf view**
- Covers sit on shelf ledges, with title, author and a progress bar when progress is above 0.
- Cover-size slider, shelf or list layout, sort (title, author, date added, last opened, progress) and grouping (shelf, author, type, none).
- Select several items with Ctrl+click or Shift+click. The right-click menu covers star, finished, shelves, type, cover, edit details, re-read metadata, Show in Explorer and remove from library.

**Reader**
- **EPUB / MOBI / AZW3 / FB2 / CBZ:** uses foliate-js. Paged or scrolling layout, one or two columns, Dark / Black / Sepia / Light themes, Serif / Sans / Mono / Original fonts, and adjustable text size, line spacing, line width and justification.
- **PDF:** uses PDF.js. Continuous scrolling, fit width, fit page, zoom, two pages side by side, dark pages, selectable text, and the PDF's outline as a table of contents.
- **Markdown / TXT / HTML:** reflowing reader that uses the same appearance settings.
- Table of contents, bookmarks (Ctrl+D), highlights in 5 colours with notes, search inside the book (Ctrl+F), and a progress slider.
- Remembers your exact position. Reading sessions are logged and used to estimate time left. Books are marked finished automatically when you reach the end.
- Focus mode (F) hides everything except the page.

**KOReader progress sync**
- Syncs your reading position with KOReader, for example on a Kindle running KOReader, using KOReader's own sync server (`https://sync.koreader.rocks` by default, or one you run yourself).
- To set it up, open **Settings › KOReader sync** and sign in with the same account you use in KOReader's **Tools › Progress sync**. You can also create the account from Trove.
- When you open a book, Trove asks the server where you are. If another device is further along and more recent, Trove jumps there. While you read, Trove sends your position about 15 seconds after you stop turning pages, and again when you close the book. The ⇅ button in the reader syncs right away.
- Books are matched the same way as KOReader's default "Binary" setting: by a fingerprint of the file, so the copy on each device must be the identical file. Copy books to the Kindle over USB, not through Calibre or Send to Kindle, because both can change the file.
- **Supported formats:**
  - **PDF and CBZ:** by page number, which is exact.
  - **EPUB:** by KOReader's paragraph-and-character position, converted to Trove's position format. If that fails, Trove falls back to the percentage.
  - Other formats don't sync.
- Only reading position syncs. Highlights and bookmarks stay on each device.

**General**
- Ctrl+K command palette: books, shelves, authors, highlights and actions.
- Ctrl+O opens files. You can also drag files or folders from Explorer onto the window.
- "Open with Trove" file associations for PDF, EPUB, MOBI, AZW3, FB2 and CBZ.

## Keyboard

| Where | Keys |
|---|---|
| Anywhere | Ctrl+K search, Ctrl+O open files |
| Library | Enter open, S star, F2 edit, Delete remove, Ctrl+A select all, Alt+←/→ back/forward |
| Reader | ←/→ page, Home/End, Ctrl+F search, Ctrl+D bookmark, Ctrl+B contents, Ctrl +/− text size or zoom, F focus mode, Esc back |

## Where data lives

Everything is in `%APPDATA%\app.trove.reader\`:
- `library.db` (SQLite): books, shelves, progress, annotations, reading sessions and settings.
- `covers\`: cover thumbnails.
- KOReader sync settings are in `library.db`. Trove stores only a hash of your sync password, which is the same value KOReader stores.

Back up that folder to keep your shelves and notes.

## Project layout

```
src-tauri/            Rust: SQLite, folder scanning and watching, file I/O, installer config
src/lib/              Library logic: schema, indexing, metadata, store (zustand), selectors
src/components/       Sidebar, shelf and list views, covers, palette, dialogs, menus
src/reader/           Reader shell and engines (PdfEngine, FoliateEngine, TextEngine)
src/vendor/foliate/   foliate-js (MIT), vendored; its built-in PDF path is disabled
scripts/              PDF.js asset copy, demo library generator, KOReader fingerprint reference
```

## Ideas for next steps

- Full-text search across the whole library (SQLite FTS5 index built during metadata extraction)
- Smart shelves from saved filters
- Read-aloud using Windows voices (foliate-js includes a TTS module)
- OPDS catalogs and metadata lookup from Open Library
- Mica window background and a custom title bar

## Licences

foliate-js is MIT. PDF.js is Apache-2.0. The bundled fonts are IBM Plex Mono and Literata, both under the SIL Open Font License.

# minimark

A minimal, distraction-free Markdown editor that reads like a nineteenth-century
book. By default it shows the **rendered** document; you edit one paragraph at a
time by placing the cursor in it — that single block reveals its raw Markdown and
returns to print when the cursor leaves.

No menu bar, no toolbars — just the page and a handful of keyboard shortcuts.

## Running it

minimark is a plain [Electron](https://www.electronjs.org/) app. There is **no
build step** — all application code is vanilla HTML/CSS/JS and the third-party
libraries (marked, DOMPurify) and the EB Garamond font are vendored as static
files, so it runs offline.

```sh
cd minimal-mark
npm install      # downloads Electron only
npm start        # or: npx electron .
```

You can also open a file directly:

```sh
npx electron . path/to/notes.md
```

## Keyboard shortcuts (press **F1** in-app)

| Shortcut | Action |
| --- | --- |
| **Ctrl + E** | Edit from the top of the visible text |
| Click a paragraph | Edit just that paragraph's Markdown |
| **↑ / ↓** at a paragraph edge | Move the edit cursor between paragraphs |
| **Esc** | Leave edit mode / close the help overlay |
| **Ctrl + S** | Save |
| **Ctrl + Shift + S** | Save as… |
| **Ctrl + O** | Open a file (remembers the last folder) |
| **Page Up / Page Down** | Previous / next portion of the document |
| **F11** | Toggle fullscreen |
| **F1** | Show / hide the shortcut overlay |

## Markdown support

GitHub-Flavored Markdown: headings, emphasis, lists, links, images, blockquotes,
fenced code, tables, task lists, strikethrough and autolinks (via
[marked](https://marked.js.org/)). Rendered HTML is sanitized with DOMPurify.

## Design notes

- The text column matches an MS Word 365 page (US-Letter width). Below that the
  layout is fully fluid; above it the column stays centered and whitespace grows
  on both sides.
- The whole document is one continuous, scrollable page.
- `source` is the single source of truth. The document is lexed into top-level
  Markdown blocks; editing a block replaces just its rendered HTML with a
  textarea of its raw source. On leaving the block the whole document is re-lexed
  and re-rendered, so reference-style links defined elsewhere always resolve.

## Project layout

```
main.js        Electron main process — window, file dialogs, last-folder memory
preload.js     Safe IPC bridge exposed to the page as `window.mm`
index.html     Markup; loads the vendored libraries
styles.css     Nineteenth-century book typography
renderer.js    Editor: block model, edit/preview toggle, hotkeys
vendor/        marked.min.js, dompurify.min.js (no CDN, offline)
fonts/         EB Garamond (woff2)
```

## License

MIT

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

## `minimark` command line

Install a global `minimark` command (like VS Code's `code`) so you can open
files from any terminal:

```sh
npm link            # run once, inside the minimal-mark folder
```

Then, from anywhere:

```sh
minimark                 # open the editor
minimark notes.md        # open (or create the path to) a file
minimark ../docs/x.md    # relative paths are resolved against the current dir
```

If the app is already open, `minimark <file>` loads the file into the existing
window instead of launching a second one. (Run `npm unlink -g minimark` to
remove the command.)

## Desktop shortcut (Windows)

Create a clickable **minimark** shortcut on your Desktop:

```sh
npm run shortcut
```

Double-click it to launch the editor. Remove it with `npm run shortcut -- -Remove`
(or just delete `minimark.lnk` from the Desktop).

## Keyboard shortcuts (press **F1** in-app)

| Shortcut | Action |
| --- | --- |
| *Reading* | |
| **↑ / ↓** | Scroll up / down |
| **Page Up / Page Down** | Previous / next portion of the document |
| *Editing* | |
| **Ctrl + E** | Edit from the top of the visible text |
| Click a paragraph | Edit just that paragraph's Markdown |
| **↑ / ↓** at a paragraph edge | Move the cursor between paragraphs |
| **Ctrl + D** | Select the word; repeat to add the next occurrence, then type to rename them all (within the current paragraph) |
| **Esc** | Leave edit mode |
| *Search* | |
| **Ctrl + F** | Find in document |
| **Enter / Shift + Enter** | Next / previous match (**F3 / Shift + F3**) |
| *File* | |
| **Ctrl + O** | Open a file (remembers the last folder) |
| **Ctrl + S** | Save |
| **Ctrl + Shift + S** | Save as… |
| *Appearance* | |
| **Ctrl + = / Ctrl + −** | Increase / decrease text size (**Ctrl + 0** resets) |
| **Ctrl + Shift + D** | Toggle dark mode |
| **F11** | Toggle fullscreen |
| *Music* | |
| **Ctrl + M** | Play a random [musicforprogramming.net](https://musicforprogramming.net) episode |
| **Ctrl + Shift + M** | Pause / resume the music |
| *Help* | |
| **F1 / Esc** | Show / hide the shortcut overlay |

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
assets/        icon.svg (in-app favicon) + icon.ico (window/taskbar/shortcut)
```

The app icon — a warm paper tile with an oxblood-underlined serif **M** — is
kept in the app palette. `assets/icon.svg` is the design source and in-app
favicon; `assets/icon.ico` is generated from it with `npm run icon`.

## License

MIT

'use strict';

/* ===========================================================================
   minimark renderer
   ---------------------------------------------------------------------------
   Model: `source` is the single source of truth. The document is lexed into
   top-level marked tokens; each non-blank token is rendered as one `.block`.
   Placing the cursor in a block swaps its rendered HTML for a <textarea>
   showing just that block's raw markdown; leaving the block re-lexes the whole
   document and re-renders, so everything (incl. reference links) stays correct.
   =========================================================================== */

const doc = document.getElementById('doc');
const scroll = document.getElementById('scroll');
const toastEl = document.getElementById('toast');
const helpEl = document.getElementById('help');
const findBar = document.getElementById('find');
const findInput = document.getElementById('find-input');
const findCountEl = document.getElementById('find-count');

marked.setOptions({ gfm: true, breaks: false });

// --- State ------------------------------------------------------------------
let source = '';
let tokens = [];
let filePath = null;
let docName = 'untitled.md';
let dirty = false;
let editing = null;     // { el, off, clen } while a block is in raw edit mode
let ms = null;          // multiselect session: { anchor, ranges, typing, base, repl }
let helpOpen = false;
let find = { open: false, query: '', hits: [], index: -1 };  // Ctrl-F find session

// --- Small helpers ----------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderToken(tok) {
  const arr = [tok];
  arr.links = tokens.links || {};
  return DOMPurify.sanitize(marked.parser(arr), { ADD_ATTR: ['target'] });
}

function setDirty(v) {
  dirty = v;
  updateTitle();
}

function updateTitle() {
  const t = `${dirty ? '• ' : ''}${docName} — minimark`;
  document.title = t;
  if (window.mm && window.mm.setTitle) window.mm.setTitle(t);
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

// --- Preferences (theme + font size), persisted in localStorage -------------
const FONT_MIN = 13;
const FONT_MAX = 34;
const FONT_DEFAULT = 20;

function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  try { localStorage.setItem('mm.dark', dark ? '1' : '0'); } catch {}
}
function toggleTheme() {
  const dark = !document.body.classList.contains('dark');
  applyTheme(dark);
  toast(dark ? 'Dark mode' : 'Light mode');
}

function applyFontSize(px) {
  const size = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
  document.documentElement.style.setProperty('--body-size', size + 'px');
  try { localStorage.setItem('mm.fontSize', String(size)); } catch {}
  if (editing) autosize(editing.el.querySelector('textarea'));
  return size;
}
function currentFontSize() {
  const v = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--body-size'));
  return Number.isFinite(v) ? v : FONT_DEFAULT;
}
function bumpFontSize(delta) {
  const a = scrollAnchor();
  const size = applyFontSize(currentFontSize() + delta);
  restoreAnchor(a);
  toast(`Text size ${Math.round(size)} px`);
}
function resetFontSize() {
  const a = scrollAnchor();
  applyFontSize(FONT_DEFAULT);
  restoreAnchor(a);
  toast(`Text size ${FONT_DEFAULT} px`);
}

function loadPrefs() {
  try {
    if (localStorage.getItem('mm.dark') === '1') document.body.classList.add('dark');
    const fs = parseFloat(localStorage.getItem('mm.fontSize'));
    if (Number.isFinite(fs)) {
      document.documentElement.style.setProperty(
        '--body-size', Math.min(FONT_MAX, Math.max(FONT_MIN, fs)) + 'px');
    }
  } catch {}
}

// --- Rendering --------------------------------------------------------------
function setSource(text, { dirty: markDirtyFlag = true } = {}) {
  source = text;
  tokens = marked.lexer(source);
  renderAll();
  if (markDirtyFlag !== null) setDirty(markDirtyFlag);
}

function renderAll() {
  const prevScroll = scroll.scrollTop;
  doc.innerHTML = '';
  // Locate each token's true position by searching from a running cursor.
  // marked does not emit tokens for some lines (notably link-reference
  // definitions, kept only in tokens.links), so summing raw lengths would
  // desync; indexOf re-syncs across any such gap.
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const rawLen = tok.raw.length;
    const found = source.indexOf(tok.raw, cursor);
    const offset = found >= 0 ? found : cursor;
    cursor = offset + rawLen;
    if (tok.type === 'space') continue;

    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.off = String(offset);
    el.dataset.clen = String(rawLen);

    const html = renderToken(tok);
    el.innerHTML = html && html.trim()
      ? html
      : `<span class="raw-hint">${escapeHtml(tok.raw.trim()) || '¶'}</span>`;

    doc.appendChild(el);
  }
  scroll.scrollTop = prevScroll;
  // Re-render wipes the DOM (and any highlights); repaint matches if searching.
  if (find.open && find.query) runFind(true);
}

// --- Block geometry helpers -------------------------------------------------
function renderedOffsets() {
  return [...doc.querySelectorAll('.block')].map((b) => +b.dataset.off);
}
function blockByOff(off) {
  return doc.querySelector(`.block[data-off="${off}"]`);
}
function topVisibleBlock() {
  const blocks = [...doc.querySelectorAll('.block')];
  const top = scroll.getBoundingClientRect().top;
  for (const b of blocks) {
    if (b.getBoundingClientRect().bottom > top + 4) return b;
  }
  return blocks[blocks.length - 1] || null;
}

// Anchor the reading position to a specific block so that operations which
// reflow the whole page (notably zooming) keep the same text under the eye
// instead of jumping to a proportional pixel offset. Capture before, restore
// after: the block that was at the top of the viewport returns to the top.
function scrollAnchor() {
  const b = topVisibleBlock();
  if (!b) return null;
  const viewTop = scroll.getBoundingClientRect().top;
  return { off: +b.dataset.off, delta: b.getBoundingClientRect().top - viewTop };
}
function restoreAnchor(a) {
  if (!a) return;
  const b = blockByOff(a.off);
  if (!b) return;
  const viewTop = scroll.getBoundingClientRect().top;
  scroll.scrollTop += (b.getBoundingClientRect().top - viewTop) - a.delta;
}

// --- Per-block editing ------------------------------------------------------
function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function openEditor(el, caret) {
  if (!el) return;
  const off = +el.dataset.off;
  const clen = +el.dataset.clen;
  const text = source.slice(off, off + clen);

  ms = null;
  const ta = document.createElement('textarea');
  ta.className = 'raw-editor';
  ta.value = text;
  ta.spellcheck = false;

  el.innerHTML = '';
  el.classList.add('editing');
  el.appendChild(ta);

  editing = { el, off, clen };

  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('blur', onEditorBlur);
  ta.addEventListener('keydown', onEditorKeydown);
  ta.addEventListener('pointerdown', () => { ms = null; }); // repositioning cancels multiselect

  ta.focus();
  autosize(ta);
  const pos = caret === 'end' ? text.length : 0;
  ta.setSelectionRange(pos, pos);
  // keep the freshly-opened block comfortably in view
  el.scrollIntoView({ block: 'nearest' });
}

// Commit the current edit back into `source`, re-lex and re-render.
// If `trackOff` is given, returns it adjusted for any length change so the
// caller can re-find a block it wanted to open next.
function commitEditing(trackOff) {
  if (!editing) return trackOff;
  const ta = editing.el.querySelector('textarea');
  const { off, clen } = editing;
  editing = null;
  ms = null;

  if (ta) {
    const newText = ta.value;
    const oldText = source.slice(off, off + clen);
    if (newText !== oldText) {
      source = source.slice(0, off) + newText + source.slice(off + clen);
      const delta = newText.length - clen;
      if (typeof trackOff === 'number' && trackOff > off) trackOff += delta;
      tokens = marked.lexer(source);
      setDirty(true);
    }
  }
  renderAll();
  return trackOff;
}

function enterEditAtOffset(off, caret) {
  if (editing) off = commitEditing(off);
  const target = blockByOff(off) || topVisibleBlock();
  openEditor(target, caret);
}

function enterEditTop() {
  if (editing) return;            // already editing somewhere
  openEditor(topVisibleBlock(), 'start');
}

function leaveEdit() {
  if (editing) commitEditing();
}

// Move the edit caret to the previous/next rendered block.
function navigate(dir, caret) {
  if (!editing) return;
  const offs = renderedOffsets();
  const idx = offs.indexOf(editing.off);
  const targetIdx = idx + dir;
  if (idx === -1 || targetIdx < 0 || targetIdx >= offs.length) {
    commitEditing();
    return;
  }
  let targetOff = offs[targetIdx];
  targetOff = commitEditing(targetOff);
  openEditor(blockByOff(targetOff), caret);
}

function atFirstLine(ta) {
  return ta.selectionStart === ta.selectionEnd &&
    ta.value.slice(0, ta.selectionStart).indexOf('\n') === -1;
}
function atLastLine(ta) {
  return ta.selectionStart === ta.selectionEnd &&
    ta.value.slice(ta.selectionEnd).indexOf('\n') === -1;
}

// --- Ctrl-D multiselect (within the active paragraph) -----------------------
function wordRangeAt(value, pos) {
  if (!value) return null;
  const isW = (c) => /\w/.test(c);
  let s = pos, e = pos;
  while (s > 0 && isW(value[s - 1])) s--;
  while (e < value.length && isW(value[e])) e++;
  if (s === e && pos > 0 && isW(value[pos - 1])) {
    e = pos; s = pos;
    while (s > 0 && isW(value[s - 1])) s--;
  }
  return s < e ? { start: s, end: e } : null;
}

function msNextOccurrence(value) {
  const anchor = ms.anchor;
  const taken = new Set(ms.ranges.map((r) => r.start));
  const find = (start) => {
    let i = value.indexOf(anchor, start);
    while (i !== -1 && taken.has(i)) i = value.indexOf(anchor, i + 1);
    return i;
  };
  let idx = find(Math.max(...ms.ranges.map((r) => r.end)));
  if (idx === -1) idx = find(0);                       // wrap around
  return idx === -1 ? null : { start: idx, end: idx + anchor.length };
}

function msAddOccurrence(ta) {
  if (ms && ms.typing) ms = null;                      // a new Ctrl-D after a rename starts fresh
  if (!ms) {
    const sel = ta.selectionStart !== ta.selectionEnd
      ? { start: ta.selectionStart, end: ta.selectionEnd }
      : wordRangeAt(ta.value, ta.selectionStart);
    if (!sel) return;
    const anchor = ta.value.slice(sel.start, sel.end);
    if (!anchor.trim()) return;
    ms = { anchor, ranges: [sel], typing: false, base: null, repl: '' };
    ta.setSelectionRange(sel.start, sel.end);
    toast('1 match — Ctrl+D for more, then type to rename');
    return;
  }
  const next = msNextOccurrence(ta.value);
  if (!next) { toast(`${ms.ranges.length} match(es) — no more`); return; }
  ms.ranges.push(next);
  ms.ranges.sort((a, b) => a.start - b.start);
  ta.setSelectionRange(next.start, next.end);
  toast(`${ms.ranges.length} matches`);
}

function msRender(ta) {
  let out = '', prev = 0, caret = 0;
  for (const r of ms.ranges) {
    out += ms.base.slice(prev, r.start) + ms.repl;
    caret = out.length;
    prev = r.end;
  }
  out += ms.base.slice(prev);
  ta.value = out;
  ta.setSelectionRange(caret, caret);
  autosize(ta);
}

function msType(ta, ch) {
  if (!ms.typing) { ms.typing = true; ms.base = ta.value; ms.repl = ''; }
  ms.repl += ch;
  msRender(ta);
}

function onEditorKeydown(e) {
  const ta = e.currentTarget;
  const ctrl = e.ctrlKey || e.metaKey;

  // Ctrl-D: select the word / add the next occurrence to the set.
  if (ctrl && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    e.stopPropagation();
    msAddOccurrence(ta);
    return;
  }

  // With a multiselect set active, typing rewrites every occurrence at once.
  if (ms) {
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      msType(ta, e.key);
      return;
    }
    if (e.key === 'Backspace' && ms.typing) {
      e.preventDefault();
      ms.repl = ms.repl.slice(0, -1);
      msRender(ta);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();       // keep the block in edit mode; just drop the set
      ms = null;
      toast('Selection cleared');
      return;
    }
    ms = null;                   // any other navigation/edit key ends the set
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    commitEditing();
    return;
  }
  if (e.key === 'ArrowUp' && atFirstLine(ta)) {
    e.preventDefault();
    navigate(-1, 'end');
  } else if (e.key === 'ArrowDown' && atLastLine(ta)) {
    e.preventDefault();
    navigate(1, 'start');
  }
}

function onEditorBlur(e) {
  // Ignore stale blur events from an editor we already replaced.
  if (!editing || !editing.el.contains(e.target)) return;
  commitEditing();
}

// Click into a rendered block -> edit it. mousedown + preventDefault keeps the
// transition smooth (the old editor is committed before focus moves).
doc.addEventListener('mousedown', (e) => {
  if (e.target.closest('textarea')) return;          // clicks inside the editor
  const block = e.target.closest('.block');
  if (!block) return;                                // clicked the margin -> blur commits
  if (editing && editing.el === block) return;       // already editing this one
  e.preventDefault();
  enterEditAtOffset(+block.dataset.off, 'start');
});

// --- Scroll position memory (per file) --------------------------------------
// Each real file remembers where it was left; reopening it later returns to the
// same place. Kept in localStorage keyed by absolute path. Untitled/welcome
// buffers have no path and are never persisted.
function scrollKey() {
  return filePath ? 'mm.scroll:' + filePath : null;
}
let scrollSaveTimer = null;
function saveScrollPos() {
  const key = scrollKey();
  if (!key) return;
  try { localStorage.setItem(key, String(Math.round(scroll.scrollTop))); } catch {}
}
function restoreScrollPos() {
  const key = scrollKey();
  let top = 0;
  if (key) {
    const v = parseFloat(localStorage.getItem(key));
    if (Number.isFinite(v)) top = v;
  }
  scroll.scrollTop = top;
  // Fonts (font-display: swap) and images can shift layout after first paint,
  // so re-apply the target once the next frame has settled.
  requestAnimationFrame(() => { scroll.scrollTop = top; });
}
scroll.addEventListener('scroll', () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveScrollPos, 200);
});
window.addEventListener('beforeunload', saveScrollPos);

// --- File operations --------------------------------------------------------
function loadContent(content, path) {
  leaveEdit();
  saveScrollPos();          // persist the outgoing file's position first
  filePath = path || null;
  docName = path ? path.split(/[\\/]/).pop() : 'untitled.md';
  setSource(content, { dirty: false });
  restoreScrollPos();
}

async function openFile() {
  const res = await window.mm.openFile();
  if (res) loadContent(res.content, res.path);
}

async function save() {
  leaveEdit();
  if (!filePath) return saveAs();
  const res = await window.mm.saveFile({ path: filePath, content: source });
  if (res && !res.canceled) { setDirty(false); toast('Saved'); }
}

async function saveAs() {
  leaveEdit();
  const res = await window.mm.saveFileAs({ content: source, suggestedName: docName });
  if (res && !res.canceled) {
    filePath = res.path;
    docName = res.path.split(/[\\/]/).pop();
    setDirty(false);
    updateTitle();
    toast('Saved');
  }
}

// --- Help overlay -----------------------------------------------------------
function toggleHelp() {
  helpOpen = !helpOpen;
  helpEl.hidden = !helpOpen;
}
helpEl.addEventListener('mousedown', (e) => {
  if (e.target === helpEl) toggleHelp();   // click backdrop to close
});

// --- Ctrl-F find in document ------------------------------------------------
// Searches the rendered text (case-insensitive), wrapping each occurrence in a
// <mark> for highlighting. Enter / Shift+Enter (or F3 / Shift+F3) step through
// matches, centering the current one. Highlights live only in the DOM, so any
// re-render simply repaints them via renderAll().
function clearFindHighlights() {
  // Query the live DOM (not find.hits, whose nodes may be detached after a
  // re-render) and unwrap each mark back into plain text.
  for (const m of doc.querySelectorAll('mark.mm-find')) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  }
  find.hits = [];
  find.index = -1;
}

function updateFindCount() {
  const total = find.hits.length;
  const cur = find.index >= 0 ? find.index + 1 : (total ? 1 : 0);
  findCountEl.textContent = total
    ? `${cur} / ${total}`
    : (find.query ? 'No results' : '');
  findBar.classList.toggle('no-results', !!find.query && total === 0);
}

function setFindCurrent(i, doScroll) {
  for (const m of find.hits) m.classList.remove('mm-find-current');
  if (i < 0 || i >= find.hits.length) { find.index = -1; updateFindCount(); return; }
  find.index = i;
  const m = find.hits[i];
  m.classList.add('mm-find-current');
  if (doScroll !== false) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateFindCount();
}

function runFind(preserveIndex) {
  const prevIndex = find.index;
  clearFindHighlights();
  const needle = find.query.toLowerCase();
  if (!needle) { updateFindCount(); return; }

  // Collect matching text nodes first — mutating the tree during a walk is
  // unsafe. Skip whitespace-only nodes and anything inside the raw editor.
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentNode && node.parentNode.closest('textarea')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n);

  for (const node of textNodes) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx === -1) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'mm-find';
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      find.hits.push(mark);
      last = idx + needle.length;
      idx = lower.indexOf(needle, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  if (find.hits.length) {
    const i = preserveIndex && prevIndex >= 0
      ? Math.min(prevIndex, find.hits.length - 1)
      : 0;
    setFindCurrent(i, true);
  } else {
    updateFindCount();
  }
}

function findNext(dir) {
  if (!find.hits.length) return;
  let i = find.index + dir;
  if (i >= find.hits.length) i = 0;
  if (i < 0) i = find.hits.length - 1;
  setFindCurrent(i, true);
}

function openFind() {
  if (editing) commitEditing();
  find.open = true;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (find.query) runFind(false);
}

function closeFind() {
  find.open = false;
  findBar.hidden = true;
  clearFindHighlights();
  updateFindCount();
  scroll.focus?.();
}

findInput.addEventListener('input', () => {
  find.query = findInput.value;
  runFind(false);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
document.getElementById('find-next').addEventListener('click', () => { findNext(1); findInput.focus(); });
document.getElementById('find-prev').addEventListener('click', () => { findNext(-1); findInput.focus(); });
document.getElementById('find-close').addEventListener('click', closeFind);

// --- musicforprogramming.net playback ---------------------------------------
const audio = new Audio();
audio.preload = 'none';
let mfpEpisodes = null;

async function playRandomEpisode() {
  try {
    if (!mfpEpisodes) {
      toast('Fetching music…');
      const res = await window.mm.mfpEpisodes();
      if (res.error || !res.episodes || !res.episodes.length) {
        toast('Could not reach musicforprogramming.net');
        return;
      }
      mfpEpisodes = res.episodes;
    }
    const ep = mfpEpisodes[Math.floor(Math.random() * mfpEpisodes.length)];
    audio.src = ep.url;
    await audio.play();
    toast(`♪ ${ep.title}`);
  } catch {
    toast('Playback failed');
  }
}

function toggleMusicPause() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play().then(() => toast('♪ Resumed')).catch(() => {});
  } else {
    audio.pause();
    toast('♪ Paused');
  }
}

// --- Global keyboard --------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); toggleHelp(); return; }
  if (helpOpen) {
    if (e.key === 'Escape') { e.preventDefault(); toggleHelp(); }
    return;
  }
  if (e.key === 'F11') { e.preventDefault(); window.mm.toggleFullscreen(); return; }

  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.shiftKey ? saveAs() : save();
    return;
  }
  if (ctrl && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(); return; }
  if (e.key === 'F3') { e.preventDefault(); if (find.open) findNext(e.shiftKey ? -1 : 1); return; }
  if (ctrl && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFile(); return; }
  if (ctrl && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); enterEditTop(); return; }
  if (ctrl && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    e.shiftKey ? toggleMusicPause() : playRandomEpisode();
    return;
  }
  if (ctrl && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    toggleTheme();
    return;
  }
  if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); bumpFontSize(1); return; }
  if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); bumpFontSize(-1); return; }
  if (ctrl && e.key === '0') { e.preventDefault(); resetFontSize(); return; }

  // While typing in the find box, let it own the remaining keys (arrows, page
  // keys); its own handler covers Enter/Esc.
  if (document.activeElement === findInput) return;

  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    const dir = e.key === 'PageDown' ? 1 : -1;
    scroll.scrollBy({ top: dir * scroll.clientHeight * 0.9, behavior: 'smooth' });
    return;
  }

  // While reading (not editing a paragraph), the arrow keys scroll the page.
  if (!editing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    scroll.scrollBy({ top: e.key === 'ArrowDown' ? 72 : -72 });
    return;
  }

  if (e.key === 'Escape' && editing) {
    e.preventDefault();
    commitEditing();
  }
});

// --- Startup ----------------------------------------------------------------
loadPrefs();

if (window.mm && window.mm.onFileOpened) {
  window.mm.onFileOpened(({ path, content }) => loadContent(content, path));
}

const WELCOME = `# minimark

*A quiet place to read and write Markdown.*

By default minimark shows the **rendered** document — set as if it were a page
from a nineteenth-century book. To change a paragraph, simply click it: that one
block reveals its raw Markdown. Click elsewhere, or press **Esc**, and it settles
back into print.

## A few first steps

- Press **Ctrl + E** to start editing from the top of the screen.
- Use **↑** and **↓** at the edge of a paragraph to move between blocks.
- **Ctrl + O** opens a file, **Ctrl + S** saves it.
- Press **F1** at any time to see every shortcut.

> Typography is the craft of endowing human language with a durable visual form.

Happy writing.
`;

setSource(WELCOME, { dirty: false });
updateTitle();

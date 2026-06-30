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

marked.setOptions({ gfm: true, breaks: false });

// --- State ------------------------------------------------------------------
let source = '';
let tokens = [];
let filePath = null;
let docName = 'untitled.md';
let dirty = false;
let editing = null;     // { el, off, clen } while a block is in raw edit mode
let helpOpen = false;

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

function onEditorKeydown(e) {
  const ta = e.currentTarget;
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

// --- File operations --------------------------------------------------------
function loadContent(content, path) {
  leaveEdit();
  filePath = path || null;
  docName = path ? path.split(/[\\/]/).pop() : 'untitled.md';
  setSource(content, { dirty: false });
  scroll.scrollTop = 0;
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
  if (ctrl && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFile(); return; }
  if (ctrl && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); enterEditTop(); return; }
  if (ctrl && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    e.shiftKey ? toggleMusicPause() : playRandomEpisode();
    return;
  }

  if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    const dir = e.key === 'PageDown' ? 1 : -1;
    scroll.scrollBy({ top: dir * scroll.clientHeight * 0.9, behavior: 'smooth' });
    return;
  }

  if (e.key === 'Escape' && editing) {
    e.preventDefault();
    commitEditing();
  }
});

// --- Startup ----------------------------------------------------------------
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

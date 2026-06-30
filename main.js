'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Persistent settings (remembers the last folder used in open/save dialogs).
// Stored in the per-user app data directory, never inside the project.
// ---------------------------------------------------------------------------
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = Object.assign(readSettings(), patch);
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* best-effort; ignore write failures */
  }
  return next;
}

function rememberDir(filePath) {
  if (filePath) writeSettings({ lastDir: path.dirname(filePath) });
}

function lastDir() {
  return readSettings().lastDir || app.getPath('documents');
}

// File passed on the command line, e.g. `electron . notes.md`.
function fileFromArgv(argv) {
  // In a packaged app argv[1] is the file; running from source it is after `.`.
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const candidate = args.find((a) => !a.startsWith('-') && a !== '.');
  if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  return null;
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 360,
    minHeight: 300,
    backgroundColor: '#f4ecd9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  // No menu bar at all — the app is keyboard driven (F1 shows the shortcuts).
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile('index.html');

  // Once the renderer is ready, hand it any file given on the command line.
  mainWindow.webContents.on('did-finish-load', () => {
    const startFile = fileFromArgv(process.argv);
    if (startFile) {
      try {
        const content = fs.readFileSync(startFile, 'utf8');
        rememberDir(startFile);
        mainWindow.webContents.send('file-opened', { path: startFile, content });
      } catch {
        /* ignore unreadable startup file */
      }
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// IPC: file open / save / save-as, fullscreen toggle.
// ---------------------------------------------------------------------------
ipcMain.handle('open-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    defaultPath: lastDir(),
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mkd', 'mdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const filePath = res.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf8');
  rememberDir(filePath);
  return { path: filePath, content };
});

ipcMain.handle('save-file', async (_evt, { path: filePath, content }) => {
  if (!filePath) return { canceled: true };
  fs.writeFileSync(filePath, content, 'utf8');
  rememberDir(filePath);
  return { canceled: false, path: filePath };
});

ipcMain.handle('save-file-as', async (_evt, { content, suggestedName }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(lastDir(), suggestedName || 'untitled.md'),
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, content, 'utf8');
  rememberDir(res.filePath);
  return { canceled: false, path: res.filePath };
});

ipcMain.handle('toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('set-title', (_evt, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

// ---------------------------------------------------------------------------
// musicforprogramming.net — fetch the episode list from the RSS feed in the
// main process (Node, no CORS) and hand the renderer a simple list to play.
// ---------------------------------------------------------------------------
const MFP_RSS = 'https://musicforprogramming.net/rss.xml';
let mfpCache = null;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'minimark' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpGet(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function parseEpisodes(xml) {
  const episodes = [];
  const items = xml.split('<item>').slice(1);
  for (const item of items) {
    const enc = item.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="audio[^"]*"/i) ||
      item.match(/<enclosure[^>]*url="([^"]+)"/i);
    if (!enc) continue;
    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Music For Programming';
    episodes.push({ title, url: enc[1] });
  }
  return episodes;
}

ipcMain.handle('mfp-episodes', async () => {
  if (mfpCache) return { episodes: mfpCache };
  try {
    const xml = await httpGet(MFP_RSS);
    const episodes = parseEpisodes(xml);
    if (episodes.length) mfpCache = episodes;
    return { episodes };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

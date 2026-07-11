// main.js — proceso principal de Electron
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { enhanceFile, listAudios } = require('./enhance');

const CONCURRENCY = 5;              // audios en paralelo
const ADOBE_PARTITION = 'persist:adobe';

let mainWin = null;
let currentToken = null;
let cancelFlag = false;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return { cleanVoice: 80, model: 'v2', token: null }; }
}

// Resuelve el binario de ffmpeg: 1) bundleado en resources/bin, 2) ffmpeg-static, 3) PATH.
function ffmpegPath() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  try {
    const bundled = path.join(process.resourcesPath || '', 'bin', name);
    if (fs.existsSync(bundled)) return bundled;
  } catch {}
  try { const s = require('ffmpeg-static'); if (s && fs.existsSync(s)) return s; } catch {}
  return name; // fallback al PATH del sistema
}
function saveSettings(s) { try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch {} }
function persistToken(tok) {
  currentToken = tok;
  const s = loadSettings(); s.token = tok; saveSettings(s);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWin = new BrowserWindow({
    width: 960, height: 740, minWidth: 640, minHeight: 520,
    title: 'Adobe Podcast Batch',
    ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, 'build', isMac ? 'icon.icns' : 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Extrae el token desde una ventana de Adobe (getAccessToken en memoria).
function grabTokenFrom(win, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (t) => { if (done) return; done = true; clearInterval(poll); clearTimeout(to); resolve(t); };
    const poll = setInterval(async () => {
      if (win.isDestroyed()) return finish(null);
      try {
        const tok = await win.webContents.executeJavaScript(
          `(function(){try{var t=window.adobeIMS&&window.adobeIMS.getAccessToken&&window.adobeIMS.getAccessToken();return t&&(t.token||t.tokenValue)||null;}catch(e){return null;}})()`
        );
        if (tok && typeof tok === 'string' && tok.startsWith('eyJ')) finish(tok);
      } catch {}
    }, 1200);
    const to = setTimeout(() => finish(null), timeoutMs || 0);
  });
}

// Login interactivo (ventana visible)
function connectAdobe() {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 520, height: 720, parent: mainWin, modal: true, show: true,
      title: 'Conectar con Adobe',
      webPreferences: { partition: ADOBE_PARTITION, contextIsolation: true },
    });
    authWin.loadURL('https://podcast.adobe.com/en/enhance');
    let settled = false;
    grabTokenFrom(authWin, 0).then((tok) => {   // 0 = sin timeout, hasta que aparezca
      if (settled) return; settled = true;
      if (tok) persistToken(tok);
      if (!authWin.isDestroyed()) authWin.close();
      resolve(tok);
    });
    authWin.on('closed', () => { if (!settled) { settled = true; resolve(currentToken); } });
  });
}

// Re-login silencioso: usa la sesión persistida (cookies) sin mostrar ventana.
function silentReauth() {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      show: false, webPreferences: { partition: ADOBE_PARTITION, contextIsolation: true },
    });
    w.loadURL('https://podcast.adobe.com/en/enhance');
    grabTokenFrom(w, 15000).then((tok) => {
      if (!w.isDestroyed()) w.destroy();
      if (tok) persistToken(tok);
      resolve(tok);
    });
  });
}

app.whenReady().then(async () => {
  const s = loadSettings();
  if (s.token) currentToken = s.token;      // restaura sesión guardada
  createWindow();
  // intenta refrescar el token en silencio con la sesión persistida
  silentReauth().then((tok) => {
    if (tok && mainWin && !mainWin.isDestroyed())
      mainWin.webContents.send('conn', { connected: true, email: decodeEmail(tok) });
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── IPC ───
ipcMain.handle('get-settings', () => { const s = loadSettings(); delete s.token; return s; });
ipcMain.handle('save-settings', (_e, s) => {
  const cur = loadSettings(); saveSettings({ ...cur, cleanVoice: s.cleanVoice, model: s.model }); return true;
});
ipcMain.handle('connect-adobe', async () => {
  const tok = await connectAdobe();
  return { connected: !!tok, email: tok ? decodeEmail(tok) : null };
});
ipcMain.handle('token-status', () => ({ connected: !!currentToken, email: currentToken ? decodeEmail(currentToken) : null }));

// Cola persistente (sobrevive al cerrar/reabrir). Filtra archivos que ya no existen.
ipcMain.handle('get-queue', () => {
  const s = loadSettings();
  const q = Array.isArray(s.queue) ? s.queue : [];
  return q.filter(it => { try { return it && it.path && fs.existsSync(it.path); } catch { return false; } });
});
ipcMain.handle('save-queue', (_e, q) => {
  const s = loadSettings(); s.queue = Array.isArray(q) ? q : []; saveSettings(s); return true;
});

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3','wav','m4a','aac','flac','ogg','aiff','aif','mp4','mov'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return [];
  return listAudios(r.filePaths[0]);
});

ipcMain.handle('stop-batch', () => { cancelFlag = true; return true; });

// Revela un archivo en Finder/Explorer; si es carpeta, la abre.
ipcMain.handle('reveal', (_e, p) => {
  try {
    if (p && fs.existsSync(p)) {
      const st = fs.statSync(p);
      if (st.isDirectory()) shell.openPath(p); else shell.showItemInFolder(p);
      return true;
    }
  } catch {}
  return false;
});

// Procesa una lista con concurrencia + backoff por límite de créditos.
ipcMain.handle('start-batch', async (_e, { files, cleanVoice, model }) => {
  if (!currentToken) return { ok: false, error: 'No conectado a Adobe' };
  cancelFlag = false;
  const ffmpeg = ffmpegPath();
  const send = (ch, data) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); };
  const queue = [...files];
  let index = 0;

  async function processWithRetry(filePath) {
    while (true) {
      if (cancelFlag) return { ok: false, error: 'cancelado' };
      try {
        return await enhanceFile(filePath, {
          token: currentToken, model: model || 'v2',
          cleanVoice: cleanVoice == null ? 100 : cleanVoice, ffmpeg,
          onStatus: (state, pct) => send('status', { filePath, state, pct }),
        });
      } catch (err) {
        if (err.code === 'LIMIT') {
          // sin créditos: avisar con cuenta regresiva y esperar
          const secs = err.retrySeconds && err.retrySeconds > 0 ? err.retrySeconds : 60;
          send('limit', { seconds: secs, retryAt: err.retryAt });
          send('status', { filePath, state: 'esperando' });
          const until = Date.now() + secs * 1000;
          while (Date.now() < until) {
            if (cancelFlag) return { ok: false, error: 'cancelado' };
            await new Promise(r => setTimeout(r, 1000));
          }
          send('limit-clear', {});
          continue; // reintenta el mismo archivo
        }
        if (err.code === 'AUTH') {
          const tok = await silentReauth();
          if (tok) { send('conn', { connected: true, email: decodeEmail(tok) }); continue; }
          send('auth-expired', {});
          return { ok: false, error: 'Sesión expirada — reconectá con Adobe' };
        }
        return { ok: false, error: String(err.message || err) };
      }
    }
  }

  async function worker() {
    while (index < queue.length && !cancelFlag) {
      const filePath = queue[index++];
      const res = await processWithRetry(filePath);
      send('done', { filePath, ok: res.ok, outPath: res.outPath, error: res.error });
    }
  }

  const n = Math.min(CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { ok: true, canceled: cancelFlag };
});

function decodeEmail(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
    return p.email || p.user_id || 'conectado';
  } catch { return 'conectado'; }
}

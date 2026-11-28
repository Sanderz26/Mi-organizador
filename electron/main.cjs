// Proceso principal de Electron (versión para Windows)
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* en desarrollo puede no estar */ }

const APP_ID = 'com.roa.organizador';
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const dataDir = app.getPath('userData');
const dataFile = path.join(dataDir, 'organizador-data.json');
const attachDir = path.join(dataDir, 'adjuntos');
const backupDir = path.join(dataDir, 'copias');
const prefsFile = path.join(dataDir, 'ventana.json');
fs.mkdirSync(attachDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const iconPath = path.join(__dirname, 'icon.png');
let win = null;
let tray = null;
let quitting = false;
let closeToTray = true;
let trayHintShown = false;

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

function readPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; }
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile)) return;
    const name = `datos-${new Date().toISOString().slice(0, 10)}.json`;
    const target = path.join(backupDir, name);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile, target);
    const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('datos-')).sort();
    while (files.length > 14) fs.unlinkSync(path.join(backupDir, files.shift()));
  } catch (e) { console.error('Copia diaria', e); }
}

function createWindow() {
  const prefs = readPrefs();
  win = new BrowserWindow({
    width: prefs.width || 1320,
    height: prefs.height || 860,
    x: prefs.x, y: prefs.y,
    minWidth: 420, minHeight: 560,
    title: 'Organizador',
    icon: iconPath,
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  if (prefs.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });

  // Enlaces externos en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  const savePrefs = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    try { fs.writeFileSync(prefsFile, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* */ }
  };
  win.on('resize', savePrefs);
  win.on('move', savePrefs);
  win.on('close', (e) => {
    if (!quitting && closeToTray) {
      e.preventDefault();
      win.hide();
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true;
        new Notification({ title: 'Organizador sigue activo', body: 'Queda en la bandeja para avisarte de tus recordatorios.', icon: iconPath }).show();
      }
    }
  });
}

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Organizador');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Organizador', click: showWin },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
}

// ---------- Comunicación con la interfaz ----------
ipcMain.handle('data:read', () => { try { return fs.readFileSync(dataFile, 'utf8'); } catch { return null; } });
ipcMain.handle('data:write', (_e, text) => { writeAtomic(dataFile, text); return true; });
ipcMain.on('data:writeSync', (e, text) => { try { writeAtomic(dataFile, text); } catch { /* */ } e.returnValue = true; });
ipcMain.handle('file:save', (_e, id, b64) => { fs.writeFileSync(path.join(attachDir, safeId(id)), Buffer.from(b64, 'base64')); return true; });
ipcMain.handle('file:read', (_e, id) => fs.readFileSync(path.join(attachDir, safeId(id))).toString('base64'));
ipcMain.handle('file:exists', (_e, id) => fs.existsSync(path.join(attachDir, safeId(id))));
ipcMain.handle('http', async (_e, method, url, body) => {
  try {
    if (!/^https:\/\//.test(url)) return { error: 'URL no válida' };
    const r = await net.fetch(url, { method, body: body || undefined, headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined, redirect: 'follow' });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { error: String(e?.message || e) }; }
});
ipcMain.handle('multipart', async (_e, { url, headers, fields, file }) => {
  try {
    if (!/^https:\/\//.test(url)) return { error: 'URL no válida' };
    const B = '----organizador' + Date.now().toString(16);
    const parts = [];
    for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    parts.push(Buffer.from(file.b64, 'base64'));
    parts.push(Buffer.from(`\r\n--${B}--\r\n`));
    const r = await net.fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${B}` }, body: Buffer.concat(parts) });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { error: String(e?.message || e) }; }
});
// http:// solo hacia la red de la casa (la impresora 3D); todo lo demás debe ser https://
const LAN_HTTP = /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)(:\d+)?\//i;
ipcMain.handle('request', async (_e, { method, url, headers, body, binary, timeout }) => {
  try {
    if (!/^https:\/\//.test(url) && !LAN_HTTP.test(url)) return { error: 'URL no válida' };
    const r = await net.fetch(url, { method, headers, body: body ?? undefined, redirect: 'follow', signal: timeout ? AbortSignal.timeout(timeout) : undefined });
    if (binary) return { status: r.status, b64: Buffer.from(await r.arrayBuffer()).toString('base64') };
    return { status: r.status, text: await r.text() };
  } catch (e) { return { error: String(e?.message || e) }; }
});
// Inicio de sesión con Google: abre el navegador y recibe la respuesta en un puerto local
ipcMain.handle('google:auth', (_e, authUrlBase) => new Promise((resolve) => {
  const http = require('http');
  let done = false;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
    const code = u.searchParams.get('code'), err = u.searchParams.get('error'), state = u.searchParams.get('state');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><meta charset="utf-8"><title>Organizador</title><body style="font-family:Segoe UI,system-ui;display:grid;place-items:center;height:90vh;color:#16181d"><div style="text-align:center"><h2>${code ? 'Listo, ya puedes volver a Organizador' : 'No se completó el inicio de sesión'}</h2><p style="color:#5b6170">Puedes cerrar esta pestaña.</p></div>`);
    if (!done) { done = true; server.close(); showWin(); resolve(code ? { code, state, redirectUri } : { error: err || 'cancelado' }); }
  });
  let redirectUri = '';
  server.listen(0, '127.0.0.1', () => {
    redirectUri = `http://127.0.0.1:${server.address().port}`;
    shell.openExternal(authUrlBase + '&redirect_uri=' + encodeURIComponent(redirectUri));
  });
  setTimeout(() => { if (!done) { done = true; server.close(); resolve({ error: 'tiempo' }); } }, 5 * 60000);
}));
ipcMain.handle('file:delete', (_e, id) => { try { fs.unlinkSync(path.join(attachDir, safeId(id))); } catch { /* */ } return true; });
ipcMain.handle('file:open', async (_e, id, name) => {
  const dir = path.join(app.getPath('temp'), 'organizador');
  fs.mkdirSync(dir, { recursive: true });
  const clean = String(name || 'archivo').replace(/[\\/:*?"<>|]/g, '_');
  const target = path.join(dir, clean);
  fs.copyFileSync(path.join(attachDir, safeId(id)), target);
  return shell.openPath(target);
});
ipcMain.handle('export:save', async (_e, filename, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), filename), filters: [{ name: 'Respaldo', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return true;
});
ipcMain.handle('notify', (_e, title, body) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body, icon: iconPath });
  n.on('click', showWin);
  n.show();
  return true;
});
ipcMain.handle('window:show', () => { showWin(); return true; });
ipcMain.handle('autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); return true; });
ipcMain.handle('closeToTray', (_e, on) => { closeToTray = !!on; return true; });

// ---------- Actualizaciones automáticas (desde GitHub Releases) ----------
let updateState = { state: 'idle' };
const sendUpdate = (u) => { updateState = u; if (win && !win.isDestroyed()) win.webContents.send('update', u); };
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    sendUpdate({ state: 'ready', version: i.version });
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Actualización lista', body: `Versión ${i.version}. Se instala al reiniciar la app.`, icon: iconPath });
      n.on('click', showWin);
      n.show();
    }
  });
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String(e?.message || e).slice(0, 200) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 3 * 3600 * 1000);
}
ipcMain.handle('update:status', () => ({ ...updateState, current: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update:check', async () => {
  if (!autoUpdater || !app.isPackaged) return { state: 'dev' };
  try { await autoUpdater.checkForUpdates(); } catch (e) { return { state: 'error', message: String(e?.message || e) }; }
  return updateState;
});
ipcMain.handle('update:install', () => { quitting = true; autoUpdater?.quitAndInstall(true, true); });

app.on('second-instance', showWin);
app.whenReady().then(() => {
  // Permite el micrófono para hablarle al asistente
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'notifications', 'clipboard-sanitized-write'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
  try {
    const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    closeToTray = d.settings?.closeToTray !== false;
  } catch { /* primera vez */ }
  dailyBackup();
  createWindow();
  createTray();
  setupUpdater();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !closeToTray) app.quit(); });

// ---------- Aries: abrir apps del menú Inicio y enlaces ----------
function startMenuDirs() {
  return [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
}
ipcMain.handle('apps:list', async () => {
  const out = [];
  const walk = async (dir, depth) => {
    let items = [];
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { if (depth < 3) await walk(p, depth + 1); }
      else if (/\.(lnk|url|appref-ms)$/i.test(it.name) && !/uninstall|desinstalar|readme|help|ayuda/i.test(it.name)) out.push({ label: it.name.replace(/\.(lnk|url|appref-ms)$/i, ''), path: p });
    }
  };
  for (const d of startMenuDirs()) await walk(d, 0);
  return out;
});
ipcMain.handle('apps:open', async (_e, p) => {
  const ok = startMenuDirs().some((d) => path.resolve(p).toLowerCase().startsWith(path.resolve(d).toLowerCase()));
  if (!ok) return 'Ruta no permitida';
  return shell.openPath(p);
});
ipcMain.handle('open:external', async (_e, url) => {
  if (!/^(https?:|spotify:|whatsapp:|mailto:|ms-settings:)/i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// ---------- Aries: documentos en las carpetas que elijas ----------
const insideFolders = (p, folders) => Array.isArray(folders) && folders.some((d) => d && path.resolve(p).toLowerCase().startsWith(path.resolve(d).toLowerCase() + path.sep));
ipcMain.handle('docs:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige una carpeta de documentos', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('docs:search', async (_e, { folders, query, max = 20 }) => {
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
  const words = norm(query).split(' ').filter(Boolean);
  const found = [];
  let visited = 0;
  const walk = async (dir, depth, root) => {
    if (visited > 30000) return;
    let items = [];
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      visited++;
      if (it.name.startsWith('.') || /^(node_modules|AppData|\$RECYCLE\.BIN)$/i.test(it.name)) continue;
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { if (depth < 6) await walk(p, depth + 1, root); continue; }
      const n = norm(it.name);
      if (!words.every((w) => n.includes(w))) continue;
      let st = null;
      try { st = await fs.promises.stat(p); } catch { continue; }
      found.push({ name: it.name, path: p, size: st.size, modified: st.mtimeMs, folder: path.basename(root) });
    }
  };
  for (const f of folders || []) await walk(f, 0, f);
  found.sort((a, b) => b.modified - a.modified);
  return found.slice(0, max);
});
ipcMain.handle('docs:read', async (_e, { path: p, folders }) => {
  if (!insideFolders(p, folders)) return { error: 'Ese archivo no está en tus carpetas de documentos' };
  const st = await fs.promises.stat(p);
  if (st.size > 25 * 1024 * 1024) return { error: 'El archivo es muy grande para leerlo' };
  return { b64: (await fs.promises.readFile(p)).toString('base64') };
});
ipcMain.handle('docs:open', async (_e, { path: p, folders }) => {
  if (!insideFolders(p, folders)) return 'Ese archivo no está en tus carpetas de documentos';
  return shell.openPath(p);
});

// ---------- Aries: carita chiquita flotante (cuando usas otra app) ----------
let bubbleWin = null;
function ensureBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return bubbleWin;
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 380, H = 170;
  bubbleWin = new BrowserWindow({
    width: W, height: H, x: wa.x + wa.width - W - 12, y: wa.y + wa.height - H - 12,
    frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.setVisibleOnAllWorkspaces(true);
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
  bubbleWin.on('closed', () => { bubbleWin = null; });
  return bubbleWin;
}
ipcMain.handle('bubble:show', async () => {
  const b = ensureBubble();
  if (b.webContents.isLoading()) await new Promise((r) => b.webContents.once('did-finish-load', r));
  b.webContents.send('state', { state: 'listening', text: '' });
  b.showInactive();
  return true;
});
ipcMain.on('bubble:state', (_e, s) => { if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send('state', s); });
ipcMain.on('bubble:level', (_e, l) => { if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send('level', l); });
ipcMain.handle('bubble:hide', () => { if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide(); return true; });
ipcMain.on('bubble:close', () => { bubbleWin?.hide(); win?.webContents.send('bubble', { kind: 'closed' }); });
ipcMain.on('bubble:expand', () => { bubbleWin?.hide(); showWin(); win?.webContents.send('bubble', { kind: 'expand' }); });
ipcMain.on('bubble:move', (_e, dx, dy) => { if (!bubbleWin) return; const [x, y] = bubbleWin.getPosition(); bubbleWin.setPosition(Math.round(x + dx), Math.round(y + dy)); });
ipcMain.on('bubble:mouse', (_e, ignore) => { bubbleWin?.setIgnoreMouseEvents(!!ignore, { forward: true }); });
// ¿La ventana principal está al frente? (si no, Aries usa la carita chiquita)
ipcMain.handle('window:focused', () => !!win && win.isVisible() && !win.isMinimized() && win.isFocused());

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

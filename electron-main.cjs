const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

let mainWindow;
const smokeExportEnabled = process.argv.includes('--smoke-export');
let ipcHandlersRegistered = false;
const DEV_SERVER_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const ALLOWED_EXTERNAL_HTTPS_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'discord.com',
  'ko-fi.com',
  'www.ko-fi.com',
  'refracturedgames.com',
  'www.refracturedgames.com',
  'refracturedgames.eo.page'
]);
const MAX_EXTERNAL_URL_BYTES = 1_000_000;
const MAX_AUTOSAVE_BYTES = 64 * 1024 * 1024;
const AUTOSAVE_FILENAME = 'autosave.json';
const smokeRoot = smokeExportEnabled
  ? path.resolve(process.env.TECTOLITE_SMOKE_DIR || path.join(os.tmpdir(), 'tectolite-smoke'))
  : null;

if (smokeRoot) {
  // Never let a smoke run inspect or overwrite a real user's recovery data.
  app.setPath('userData', path.join(smokeRoot, `user-data-${process.pid}`));
}

function parseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || Buffer.byteLength(rawUrl, 'utf8') > MAX_EXTERNAL_URL_BYTES) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isTrustedRendererUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed || parsed.username || parsed.password) return false;

  if (parsed.protocol === 'http:' && DEV_SERVER_ORIGINS.has(parsed.origin)) return true;
  if (parsed.protocol !== 'file:') return false;

  try {
    return isPathInside(path.join(__dirname, 'dist'), fileURLToPath(parsed));
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed || parsed.username || parsed.password) return false;
  if (parsed.protocol === 'mailto:') return true;
  return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HTTPS_HOSTS.has(parsed.hostname.toLowerCase());
}

function assertTrustedIpcSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isTrustedRendererUrl(senderUrl)) throw new Error('IPC request denied for untrusted renderer');
}

async function openAllowedExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) throw new Error('Unsupported external URL');
  await shell.openExternal(rawUrl);
}

function getAutosavePath() {
  return path.join(app.getPath('userData'), AUTOSAVE_FILENAME);
}

function validateAutosaveJson(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_AUTOSAVE_BYTES) {
    throw new Error('Autosave must be JSON text no larger than 64 MiB');
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Autosave is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Autosave JSON must contain an object');
  }
}

function writeAutosaveAtomically(value) {
  validateAutosaveJson(value);
  writeJsonAtomically(getAutosavePath(), value);
}

function writeJsonAtomically(targetPath, value) {
  const parentDir = path.dirname(targetPath);
  const temporaryPath = path.join(parentDir, `${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(parentDir, { recursive: true });

  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, value, 'utf8');
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryPath, targetPath);

    // Flush the directory entry on platforms that support opening directories.
    if (process.platform !== 'win32') {
      const directoryDescriptor = fs.openSync(parentDir, 'r');
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function readAutosave() {
  const autosavePath = getAutosavePath();
  try {
    const stats = fs.statSync(autosavePath);
    if (!stats.isFile() || stats.size > MAX_AUTOSAVE_BYTES) throw new Error('Stored autosave is invalid or too large');
    const value = fs.readFileSync(autosavePath, 'utf8');
    validateAutosaveJson(value);
    return value;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function clearAutosave() {
  try {
    fs.unlinkSync(getAutosavePath());
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.handle('open-external', (event, url) => {
    assertTrustedIpcSender(event);
    return openAllowedExternalUrl(url);
  });

  ipcMain.handle('save-bug-report', async (event, reportId, reportText, screenshotDataUrl) => {
    assertTrustedIpcSender(event);
    const safeReportId = typeof reportId === 'string' ? reportId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
    if (!safeReportId) throw new Error('Invalid bug report ID');
    if (typeof reportText !== 'string' || reportText.length > 2_000_000) throw new Error('Invalid bug report text');
    if (typeof screenshotDataUrl === 'string' && screenshotDataUrl.length > 15_000_000) throw new Error('Bug report screenshot is too large');

    const bugsDir = path.join(app.getPath('userData'), 'bugs');
    fs.mkdirSync(bugsDir, { recursive: true });

    const textPath = path.join(bugsDir, `${safeReportId}.txt`);
    fs.writeFileSync(textPath, reportText, 'utf-8');

    if (typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:image/')) {
      const base64 = screenshotDataUrl.split(',')[1];
      if (base64) {
        const shotPath = path.join(bugsDir, `${safeReportId}-screenshot.png`);
        fs.writeFileSync(shotPath, Buffer.from(base64, 'base64'));
      }
    }

    return bugsDir;
  });

  ipcMain.handle('autosave:write', (event, value) => {
    assertTrustedIpcSender(event);
    writeAutosaveAtomically(value);
  });

  ipcMain.handle('project:save', async (event, json, filename) => {
    assertTrustedIpcSender(event);
    validateAutosaveJson(json);
    const safeName = typeof filename === 'string' ? path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_') : 'TectoLite.json';
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Save TectoLite project', defaultPath: safeName,
      filters: [{ name: 'TectoLite project', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return 'cancelled';
    writeJsonAtomically(result.filePath, json);
    return 'saved';
  });

  ipcMain.handle('autosave:read', (event) => {
    assertTrustedIpcSender(event);
    return readAutosave();
  });

  ipcMain.handle('autosave:clear', (event) => {
    assertTrustedIpcSender(event);
    clearAutosave();
  });
}

function finishSmokeExport(code, message) {
  console.log(message);
  setTimeout(() => app.exit(code), 0);
}

function setupSmokeExport(window) {
  const smokeTimeoutMs = Number(process.env.TECTOLITE_SMOKE_TIMEOUT_MS || 30000);
  const smokeDir = smokeRoot || path.join(app.getPath('temp'), 'tectolite-smoke');
  const downloadPath = path.join(smokeDir, `tectolite-smoke-${Date.now()}.gpkg`);
  let finished = false;

  const finish = (code, message) => {
    if (finished) return;
    finished = true;
    finishSmokeExport(code, message);
  };

  fs.mkdirSync(smokeDir, { recursive: true });

  const timeout = setTimeout(async () => {
    try {
      const rendererError = await window.webContents.executeJavaScript('window.__TECTOLITE_SMOKE_LAST_ERROR__ ?? null', true);
      if (rendererError) {
        finish(1, `[smoke-export] renderer error: ${rendererError}`);
        return;
      }
    } catch (error) {
      finish(1, `[smoke-export] timeout while reading renderer state: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    finish(1, `[smoke-export] timed out after ${smokeTimeoutMs}ms without a completed download`);
  }, smokeTimeoutMs);

  window.webContents.session.once('will-download', (event, item) => {
    item.setSavePath(downloadPath);
    item.once('done', () => {
      clearTimeout(timeout);

      if (!fs.existsSync(downloadPath)) {
        finish(1, '[smoke-export] download reported complete but no file was written');
        return;
      }

      const stats = fs.statSync(downloadPath);
      if (stats.size <= 0) {
        finish(1, '[smoke-export] downloaded GeoPackage file is empty');
        return;
      }

      finish(0, `[smoke-export] success: ${downloadPath} (${stats.size} bytes)`);
    });
  });

  window.webContents.once('did-finish-load', async () => {
    try {
      await window.webContents.executeJavaScript(`
        (async () => {
          window.__TECTOLITE_SMOKE_LAST_ERROR__ = null;

          const firstAutosave = JSON.stringify({ smoke: 1 });
          const secondAutosave = JSON.stringify({ smoke: 2 });
          await window.electron.writeAutosave(firstAutosave);
          await window.electron.writeAutosave(secondAutosave);
          if (await window.electron.readAutosave() !== secondAutosave) {
            throw new Error('atomic autosave round-trip failed');
          }
          await window.electron.clearAutosave();
          if (await window.electron.readAutosave() !== null) {
            throw new Error('autosave clear failed');
          }

          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 10000;
            const triggerExport = () => {
              const button = document.getElementById('btn-export');
              if (button) {
                window.__TECTOLITE_SMOKE_EXPORT__ = {
                  format: 'qgis',
                  width: 512,
                  height: 256,
                  projection: 'equirectangular',
                  includeHeightmap: true
                };
                button.click();
                resolve(true);
                return;
              }

              if (Date.now() > deadline) {
                reject(new Error('btn-export not found'));
                return;
              }

              setTimeout(triggerExport, 100);
            };

            triggerExport();
          });
        })();
      `, true);
    } catch (error) {
      clearTimeout(timeout);
      finish(1, `[smoke-export] failed to trigger export: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function createWindow() {
  registerIpcHandlers();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    },
    icon: path.join(__dirname, 'assets/icon.png') // Optional: add an icon
  });

  // Load the app
  // Smoke runs exercise the production bundle even when launched through the
  // local Electron binary, where app.isPackaged normally selects Vite.
  const startUrl = !app.isPackaged && !smokeExportEnabled
    ? 'http://localhost:5173' // Vite dev server
    : pathToFileURL(path.join(__dirname, 'dist/index.html')).href; // Production build

  mainWindow.loadURL(startUrl);

  // The app does not need camera, microphone, geolocation, notifications, MIDI,
  // USB, serial, clipboard-read, or any other Chromium permission.
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  // Keep web content inside the app window and delegate only explicitly trusted
  // destinations to the operating system.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void openAllowedExternalUrl(url).catch(error => console.error('[external-url]', error));
    return { action: 'deny' };
  });

  const guardNavigation = (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void openAllowedExternalUrl(url).catch(error => console.error('[external-url]', error));
  };
  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);

  // Open DevTools in development
  if (!app.isPackaged && !smokeExportEnabled) {
    mainWindow.webContents.openDevTools();
  }

  if (smokeExportEnabled) {
    setupSmokeExport(mainWindow);
  }

  // Confirm before closing with unsaved changes. The renderer mirrors its
  // dirty state into window.__TECTOLITE_HAS_UNSAVED__ (see src/main.ts);
  // beforeunload is not used because Electron cancels the close silently
  // without showing any dialog.
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (forceClose || smokeExportEnabled) return;
    e.preventDefault(); // must happen synchronously; re-close below if allowed

    const win = mainWindow;
    win.webContents.executeJavaScript('window.__TECTOLITE_HAS_UNSAVED__ === true', true)
      .catch(() => false)
      .then((hasUnsaved) => {
        if (hasUnsaved) {
          const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Quit Without Saving', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Unsaved Changes',
            message: 'You have unsaved changes.',
            detail: 'Your project has changes that have not been saved. Quit anyway?'
          });
          if (choice !== 0) return; // keep the window open
        }
        forceClose = true;
        win.close();
      });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('window-all-closed', () => {
  // On macOS, apps stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Create application menu
const template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Exit',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.quit();
        }
      }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' }
    ]
  },
  {
    label: 'View',
    submenu: [
      ...(!app.isPackaged ? [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' }
      ] : []),
      { role: 'togglefullscreen' }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

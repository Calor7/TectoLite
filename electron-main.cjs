const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;
const smokeExportEnabled = process.argv.includes('--smoke-export');
const smokeHeightmapValidationEnabled = process.argv.includes('--smoke-heightmap-validation');
const smokeEnabled = smokeExportEnabled || smokeHeightmapValidationEnabled;
let ipcHandlersRegistered = false;

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:'))) {
      return shell.openExternal(url);
    }
    throw new Error('Unsupported external URL');
  });

  ipcMain.handle('save-bug-report', async (_event, reportId, reportText, screenshotDataUrl) => {
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
}

function finishSmokeExport(code, message) {
  console.log(message);
  setTimeout(() => app.exit(code), 0);
}

function setupSmokeExport(window) {
  const smokeTimeoutMs = Number(process.env.TECTOLITE_SMOKE_TIMEOUT_MS || 30000);
  const smokeDir = process.env.TECTOLITE_SMOKE_DIR || path.join(app.getPath('temp'), 'tectolite-smoke');
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
        window.__TECTOLITE_SMOKE_LAST_ERROR__ = null;
        new Promise((resolve, reject) => {
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
      `, true);
    } catch (error) {
      clearTimeout(timeout);
      finish(1, `[smoke-export] failed to trigger export: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function setupHeightmapValidationSmoke(window) {
  const timeout=setTimeout(()=>finishSmokeExport(1,'[smoke-heightmap-validation] timed out'),15000);
  window.webContents.once('did-finish-load',async()=>{try{const result=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const run=()=>{const button=document.getElementById('btn-export');if(!button){if(Date.now()>deadline){reject(new Error('btn-export not found'));return;}setTimeout(run,50);return;}button.click();setTimeout(()=>{const format=document.getElementById('fmt-heightmap'),width=document.getElementById('hm-width'),confirm=document.getElementById('export-confirm');if(!format||!width||!confirm){reject(new Error('unified heightmap controls not found'));return;}format.click();width.value='4096.5';confirm.click();setTimeout(()=>{const alert=document.getElementById('export-validation-error');resolve({visible:!!alert&&alert.style.display==='block',message:alert?.textContent||'',modalConnected:!!alert?.isConnected,widthValue:width.value});},50);},50);};run();})`,true);clearTimeout(timeout);if(result.visible&&result.modalConnected&&/even integer/.test(result.message)&&result.widthValue==='4096.5')finishSmokeExport(0,`[smoke-heightmap-validation] success: ${JSON.stringify(result)}`);else finishSmokeExport(1,`[smoke-heightmap-validation] failed: ${JSON.stringify(result)}`);}catch(error){clearTimeout(timeout);finishSmokeExport(1,`[smoke-heightmap-validation] error: ${error instanceof Error?error.message:String(error)}`);}});
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
      sandbox: true
    },
    icon: path.join(__dirname, 'assets/icon.png') // Optional: add an icon
  });

  // Load the app
  // Smoke runs exercise the production bundle even when launched through the
  // local Electron binary, where app.isPackaged normally selects Vite.
  const startUrl = !app.isPackaged && !smokeEnabled
    ? 'http://localhost:5173' // Vite dev server
    : `file://${path.join(__dirname, 'dist/index.html')}`; // Production build

  mainWindow.loadURL(startUrl);

  // Delegate mailto: and external URLs to the OS default handler
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mailto:') || url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Open DevTools in development
  if (!app.isPackaged && !smokeExportEnabled) {
    mainWindow.webContents.openDevTools();
  }

  if (smokeExportEnabled) {
    setupSmokeExport(mainWindow);
  } else if (smokeHeightmapValidationEnabled) {
    setupHeightmapValidationSmoke(mainWindow);
  }

  // Confirm before closing with unsaved changes. The renderer mirrors its
  // dirty state into window.__TECTOLITE_HAS_UNSAVED__ (see src/main.ts);
  // beforeunload is not used because Electron cancels the close silently
  // without showing any dialog.
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (forceClose || smokeEnabled) return;
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
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

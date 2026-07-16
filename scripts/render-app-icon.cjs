const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets', 'icon.svg');
const destination = path.join(root, 'assets', 'icon.png');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  });

  const svg = fs.readFileSync(source, 'utf8');
  const html = `<!doctype html><style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(resolve => setTimeout(resolve, 100));
  window.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 100));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png = image.toPNG();
  if (png.length === 0) throw new Error('Electron produced an empty icon image');
  fs.writeFileSync(destination, png);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});

// Renderiza icon.html a un PNG 1024x1024 usando Electron (offscreen).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false,
    transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise(r => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, 'icon-1024.png'), img.toPNG());
  console.log('OK icon-1024.png');
  app.quit();
});

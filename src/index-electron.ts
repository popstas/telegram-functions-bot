import { app, BrowserWindow, Tray, Menu } from 'electron';
import path from 'path';
import { readConfig, validateConfig, watchConfigChanges } from './config';
import { log } from './helpers';
import { start } from './index';

const configPath = process.env.CONFIG || 'config.yml';
let config = readConfig(configPath);

if (!validateConfig(config)) {
  console.log('Invalid config, exiting...');
  process.exit(1);
}

watchConfigChanges();

app.on('ready', () => {
  createWindow();
  start();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');

  const tray = new Tray(path.join(__dirname, 'trayIcon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Telegram Functions Bot');
  tray.setContextMenu(contextMenu);

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

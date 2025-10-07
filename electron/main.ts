import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { createDefaultLogTailer, LogEntry, LogTailer } from "./logTail.ts";
import { startBot, stopBot } from "../src/index.ts";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let tailer: LogTailer | null = null;
let botRunning = false;
let quitting = false;
let rendererReady = false;
const pendingLogs: LogEntry[] = [];
const FALLBACK_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQ4T2NkoBAwUqifgYGB4T8GphE0DSqGhgYAJDUEAK0YELkAAAAASUVORK5CYII=";

function assetPath(file: string) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, file);
  }
  return path.join(app.getAppPath(), "electron", "assets", file);
}

function resolveHtml() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "index.html");
  }
  return path.join(app.getAppPath(), "electron", "index.html");
}

function resolvePreload() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "preload.js");
  }
  return path.join(app.getAppPath(), "electron", "preload.ts");
}

function ensureLogsDir() {
  const dir = path.resolve("data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreload(),
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  await mainWindow.loadFile(resolveHtml());
}

function sendBotState() {
  if (!mainWindow) return;
  mainWindow.webContents.send("bot:state", { running: botRunning });
}

function sendLog(entry: LogEntry) {
  if (!mainWindow || !rendererReady) {
    pendingLogs.push(entry);
    return;
  }
  mainWindow.webContents.send("logs:append", entry);
}

function flushPendingLogs() {
  if (!mainWindow) return;
  while (pendingLogs.length) {
    const entry = pendingLogs.shift();
    if (!entry) break;
    mainWindow.webContents.send("logs:append", entry);
  }
}

async function startLogTailer() {
  const logsDir = ensureLogsDir();
  tailer = createDefaultLogTailer(logsDir);
  tailer.on("log", (entry) => sendLog(entry));
  tailer.on("error", (error) => {
    mainWindow?.webContents.send("logs:error", error.message);
  });
  await tailer.start();
}

async function startBotProcess() {
  try {
    await startBot();
    botRunning = true;
  } catch (error) {
    console.error("Failed to start bot", error);
    botRunning = false;
  }
  sendBotState();
  updateTrayMenu();
}

async function stopBotProcess() {
  try {
    await stopBot();
  } catch (error) {
    console.error("Failed to stop bot", error);
  }
  botRunning = false;
  sendBotState();
  updateTrayMenu();
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function resolveTrayIcon() {
  const iconPath = assetPath("icon.png");
  const fileIcon = nativeImage.createFromPath(iconPath);
  if (!fileIcon.isEmpty()) {
    return fileIcon;
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

function createTray() {
  const icon = resolveTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Telegram Functions Bot");
  tray.on("click", () => toggleWindowVisibility());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const template: MenuItemConstructorOptions[] = [
    {
      label: botRunning ? "Stop bot" : "Start bot",
      click: () => {
        if (botRunning) {
          void stopBotProcess();
        } else {
          void startBotProcess();
        }
      },
    },
    {
      label: "Show window",
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Open logs folder",
      click: () => void shell.openPath(ensureLogsDir()),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: async () => {
        quitting = true;
        await stopBotProcess();
        tailer?.stop();
        app.exit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.handle("bot:toggle", async () => {
    if (botRunning) {
      await stopBotProcess();
    } else {
      await startBotProcess();
    }
  });

  ipcMain.handle("logs:open-folder", async () => {
    await shell.openPath(ensureLogsDir());
  });

  ipcMain.on("renderer-ready", () => {
    rendererReady = true;
    flushPendingLogs();
    sendBotState();
  });

  ipcMain.handle("window:toggle", () => {
    toggleWindowVisibility();
  });
}

app.on("window-all-closed", () => {
  // keep the tray application running
});

app.on("activate", () => {
  if (!mainWindow) {
    void createWindow().then(() => {
      sendBotState();
    });
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", async (event) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  await stopBotProcess();
  tailer?.stop();
  app.exit();
});

app.whenReady().then(async () => {
  await createWindow();
  createTray();
  registerIpcHandlers();
  await startBotProcess();
  await startLogTailer();
});

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
import { LogEntry, LogLevel, parseLogLine, type LogSource } from "./logTail.ts";
import { subscribeToLogs, type LogDispatchPayload } from "../src/helpers.ts";
import { startBot, stopBot } from "../src/index.ts";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let botRunning = false;
let quitting = false;
let rendererReady = false;
const pendingLogs: LogEntry[] = [];
let logStream: fs.WriteStream | null = null;
let detachLogSubscription: (() => void) | null = null;
const FALLBACK_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQ4T2NkoBAwUqifgYGB4T8GphE0DSqGhgYAJDUEAK0YELkAAAAASUVORK5CYII=";

function getLogStream() {
  if (logStream) return logStream;
  const dir = ensureLogsDir();
  const file = path.join(dir, "electron.log");
  try {
    logStream = fs.createWriteStream(file, { flags: "a" });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error("[desktop] Failed to open electron log file", err);
    logStream = null;
  }
  return logStream;
}

function serializeDetails(details: unknown) {
  if (details instanceof Error) {
    return details.stack ?? details.message;
  }
  if (typeof details === "string") {
    return details;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function logDesktop(message: string, level: LogLevel = "info", details?: unknown) {
  const timestamp = new Date().toISOString();
  const consoleMethod =
    level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.log;
  if (details !== undefined) {
    consoleMethod("[desktop]", message, details);
  } else {
    consoleMethod("[desktop]", message);
  }

  const entry: LogEntry = {
    source: "desktop",
    raw: details instanceof Error ? `${message}: ${details.stack ?? details.message ?? details}` : message,
    message,
    timestamp,
    level,
  };

  const stream = getLogStream();
  if (stream) {
    const detailText = details === undefined ? "" : ` ${serializeDetails(details)}`;
    stream.write(`[${timestamp}] [${level.toUpperCase()}] ${message}${detailText}\n`);
  }

  sendLog(entry);
}

function appBasePath() {
  const appPath = app.getAppPath();

  if (app.isPackaged) {
    const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
    if (electronProcess.resourcesPath) {
      return electronProcess.resourcesPath;
    }
    return appPath;
  }

  const directHtml = path.join(appPath, "index.html");
  if (fs.existsSync(directHtml)) {
    return appPath;
  }

  const electronDir = path.join(appPath, "electron");
  if (fs.existsSync(path.join(electronDir, "index.html"))) {
    return electronDir;
  }

  return appPath;
}

function resolveExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? "";
}

function assetPath(file: string) {
  const base = appBasePath();
  const candidates = app.isPackaged
    ? [path.join(base, file), path.join(base, "assets", file)]
    : [path.join(base, "assets", file), path.join(base, file), path.join(app.getAppPath(), "assets", file)];

  return resolveExistingPath(candidates);
}

function resolveHtml() {
  const base = appBasePath();
  const candidates = [path.join(base, "index.html"), path.join(app.getAppPath(), "electron", "index.html")];
  return resolveExistingPath(candidates);
}

function resolvePreload() {
  const base = appBasePath();
  const candidates = app.isPackaged
    ? [
        path.join(base, "preload.js"),
        path.join(base, "preload.cjs"),
        path.join(base, "preload.mjs"),
        path.join(base, "dist-electron", "preload.js"),
      ]
    : [
        path.join(base, "preload.js"),
        path.join(base, "preload.mjs"),
        path.join(base, "dist-electron", "preload.js"),
        path.join(app.getAppPath(), "electron", "preload.js"),
        path.join(app.getAppPath(), "electron", "preload.ts"),
      ];

  return resolveExistingPath(candidates);
}

function ensureLogsDir() {
  const dir = path.resolve("data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function markRendererReady(reason: string) {
  if (rendererReady) {
    logDesktop(`Renderer already marked ready (via ${reason})`, "debug");
    return;
  }
  rendererReady = true;
  logDesktop(`Renderer marked ready (via ${reason})`, "debug");
  reportPendingLogsQueued();
  flushPendingLogs();
  sendBotState();
}

async function createWindow() {
  logDesktop("Creating main window");
  rendererReady = false;
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
    logDesktop("Renderer ready-to-show event received", "debug");
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    const browserEvent = event as { preventDefault?: () => void } | undefined;
    browserEvent?.preventDefault?.();
    mainWindow?.hide();
    logDesktop("Main window hidden instead of closed", "debug");
  });

  const htmlPath = resolveHtml();
  logDesktop(`Loading renderer HTML from ${htmlPath}`);
  await mainWindow.loadFile(htmlPath);
  markRendererReady("loadFile resolved");
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

function reportPendingLogsQueued() {
  if (!pendingLogs.length) {
    return;
  }
  logDesktop(`Queued ${pendingLogs.length} log entries while renderer initialized`, "debug");
}

function flushPendingLogs() {
  if (!mainWindow) return;
  while (pendingLogs.length) {
    const entry = pendingLogs.shift();
    if (!entry) break;
    mainWindow.webContents.send("logs:append", entry);
  }
}

async function startBotProcess() {
  logDesktop("Starting bot process");
  try {
    await startBot();
    botRunning = true;
    logDesktop("Bot process started successfully");
  } catch (error) {
    console.error("Failed to start bot", error);
    botRunning = false;
    logDesktop("Failed to start bot", "error", error);
  }
  sendBotState();
  updateTrayMenu();
}

async function stopBotProcess() {
  logDesktop("Stopping bot process");
  try {
    await stopBot();
  } catch (error) {
    console.error("Failed to stop bot", error);
    logDesktop("Failed to stop bot", "error", error);
  }
  botRunning = false;
  logDesktop("Bot process stopped", "debug");
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
  logDesktop("Tray initialized");
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
        stopLogForwarding();
        app.exit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

const RUNTIME_LOG_SOURCES = new Map<string, LogSource>([
  ["messages.log", "messages"],
  ["http.log", "http"],
]);

function handleLogEvent(payload: LogDispatchPayload) {
  if (!payload.logPath) {
    return;
  }
  const fileName = path.basename(payload.logPath);
  const source = RUNTIME_LOG_SOURCES.get(fileName);
  if (!source) {
    return;
  }
  const entry = parseLogLine(source, payload.formatted);
  sendLog(entry);
}

function startLogForwarding() {
  if (detachLogSubscription) {
    return;
  }
  detachLogSubscription = subscribeToLogs((payload) => handleLogEvent(payload));
  logDesktop("Subscribed to runtime log stream", "debug");
}

function stopLogForwarding() {
  if (!detachLogSubscription) {
    return;
  }
  detachLogSubscription();
  detachLogSubscription = null;
  logDesktop("Runtime log stream unsubscribed", "debug");
}

function registerIpcHandlers() {
  ipcMain.handle("bot:toggle", async () => {
    logDesktop("IPC: bot:toggle invoked", "debug");
    if (botRunning) {
      await stopBotProcess();
    } else {
      await startBotProcess();
    }
  });

  ipcMain.handle("logs:open-folder", async () => {
    logDesktop("IPC: logs:open-folder invoked", "debug");
    await shell.openPath(ensureLogsDir());
  });

  ipcMain.on("renderer-ready", () => {
    logDesktop("Renderer reported ready", "debug");
    markRendererReady("renderer IPC");
  });

  ipcMain.handle("window:toggle", () => {
    logDesktop("IPC: window:toggle invoked", "debug");
    toggleWindowVisibility();
  });
}

app.on("window-all-closed", () => {
  // keep the tray application running
});

app.on("activate", () => {
  if (!mainWindow) {
    logDesktop("App activated without window, recreating", "debug");
    void createWindow().then(() => {
      sendBotState();
    });
  } else {
    logDesktop("App activated, showing existing window", "debug");
    mainWindow.show();
  }
});

app.on("before-quit", async (event: { preventDefault: () => void }) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  logDesktop("Application quitting, stopping services");
  await stopBotProcess();
  stopLogForwarding();
  app.exit();
});

app.on("quit", () => {
  stopLogForwarding();
  if (logStream) {
    logStream.end();
    logStream = null;
  }
});

app.whenReady().then(async () => {
  logDesktop("Electron app ready", "debug");
  startLogForwarding();
  await createWindow();
  createTray();
  registerIpcHandlers();
  await startBotProcess();
});

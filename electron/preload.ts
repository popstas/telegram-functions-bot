import { contextBridge, ipcRenderer } from "electron";
import type { LogEntry } from "./logTail.ts";

type LogListener = (entry: LogEntry) => void;
type BotStateListener = (state: { running: boolean }) => void;

declare global {
  interface Window {
    desktop: {
      onLog: (listener: LogListener) => () => void;
      onBotState: (listener: BotStateListener) => () => void;
      toggleBot: () => Promise<void>;
      openLogsFolder: () => Promise<void>;
      toggleWindow: () => Promise<void>;
      notifyReady: () => void;
    };
  }
}

contextBridge.exposeInMainWorld("desktop", {
  onLog(listener: LogListener) {
    const handler = (_event: unknown, entry: LogEntry) => listener(entry);
    ipcRenderer.on("logs:append", handler);
    return () => ipcRenderer.off("logs:append", handler);
  },
  onBotState(listener: BotStateListener) {
    const handler = (_event: unknown, state: { running: boolean }) => listener(state);
    ipcRenderer.on("bot:state", handler);
    return () => ipcRenderer.off("bot:state", handler);
  },
  async toggleBot() {
    await ipcRenderer.invoke("bot:toggle");
  },
  async openLogsFolder() {
    await ipcRenderer.invoke("logs:open-folder");
  },
  async toggleWindow() {
    await ipcRenderer.invoke("window:toggle");
  },
  notifyReady() {
    ipcRenderer.send("renderer-ready");
  },
});

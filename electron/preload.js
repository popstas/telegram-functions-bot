import { contextBridge, ipcRenderer } from "electron";

/** @typedef {import("./logTail.ts").LogEntry} LogEntry */

/**
 * @typedef {(entry: LogEntry) => void} LogListener
 * @typedef {(state: { running: boolean }) => void} BotStateListener
 */

contextBridge.exposeInMainWorld("desktop", {
  /**
   * @param {LogListener} listener
   * @returns {() => void}
   */
  onLog(listener) {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on("logs:append", handler);
    return () => ipcRenderer.off("logs:append", handler);
  },
  /**
   * @param {BotStateListener} listener
   * @returns {() => void}
   */
  onBotState(listener) {
    const handler = (_event, state) => listener(state);
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

import { EventEmitter } from "node:events";

declare module "electron" {
  interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    show?: boolean;
    autoHideMenuBar?: boolean;
    webPreferences?: {
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      preload?: string;
    };
  }

  export interface MenuItemConstructorOptions {
    label?: string;
    click?: () => void;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
    submenu?: MenuItemConstructorOptions[] | Menu;
  }

  export class Menu extends EventEmitter {
    static buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  }

  export class BrowserWindow extends EventEmitter {
    constructor(options?: BrowserWindowConstructorOptions);
    loadFile(path: string): Promise<void>;
    show(): void;
    hide(): void;
    focus(): void;
    isVisible(): boolean;
    on(event: "ready-to-show" | "close", listener: (...args: unknown[]) => void): this;
    webContents: {
      send(channel: string, ...args: unknown[]): void;
    };
  }

  export class Tray extends EventEmitter {
    constructor(image: NativeImage);
    setToolTip(tip: string): void;
    setContextMenu(menu: Menu): void;
    on(event: "click", listener: (...args: unknown[]) => void): this;
  }

  export class NativeImage {
    static createFromPath(path: string): NativeImage;
    static createFromDataURL(dataUrl: string): NativeImage;
    isEmpty(): boolean;
  }

  export const nativeImage: typeof NativeImage;

  export const shell: {
    openPath(path: string): Promise<string>;
  };

  export const ipcMain: EventEmitter & {
    handle(channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void;
    on(channel: string, listener: (...args: unknown[]) => void): void;
  };

  export const ipcRenderer: EventEmitter & {
    on(channel: string, listener: (...args: unknown[]) => void): void;
    off(channel: string, listener: (...args: unknown[]) => void): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
  };

  export const contextBridge: {
    exposeInMainWorld(key: string, api: Record<string, unknown>): void;
  };

  export const app: EventEmitter & {
    whenReady(): Promise<void>;
    isPackaged: boolean;
    getAppPath(): string;
    exit(code?: number): void;
    on(
      event: "window-all-closed" | "activate" | "before-quit",
      listener: (...args: unknown[]) => void,
    ): EventEmitter;
  };
}

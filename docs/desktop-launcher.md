# Desktop launcher

The Electron launcher wraps the existing bot runtime so you can run it like a native tray app.

## Prerequisites

- Install project dependencies (`npm install`).
- Provide a valid `config.yml` just like the CLI workflow (the desktop shell reuses the same configuration).

## Run locally

```bash
npm run desktop
```

The command starts Electron with the `NODE_ENV=desktop` flag. The bot lifecycle is managed from the Electron main process, so the CLI entry point is no longer auto-started.

## Features

- Tray menu for start/stop, show/hide window, and opening the `data/` folder.
- Live log viewer that tails `data/messages.log`, `data/http.log`, and `data/mqtt.log`, and surfaces Electron lifecycle events
  through the **Desktop** filter for easier debugging.
- Pause, clear, and per-source filters plus optional auto-scroll for logs.
- Desktop lifecycle events are also saved to `data/electron.log`, providing a plain-text audit trail for troubleshooting startup
  issues even if the renderer UI is unavailable.
- Graceful shutdown of Telegram bots and MQTT subscriptions when quitting.

## Packaging

1. Bundle the Electron entry points:
   ```bash
   npm run build:electron
   ```
2. Use your preferred packaging tool (e.g. `electron-builder`) to generate installers. The bundled assets live in the `dist-electron/` directory.

> **Tip:** Add your own tray icon at `electron/assets/icon.png` before packaging; the repository intentionally leaves the placeholder untracked.

## Native modules

The vector memory tools depend on the `better-sqlite3` native module. When you launch Electron it uses its own Node.js build, so you must rebuild the binding to match:

```bash
npx electron-rebuild --only better-sqlite3
```

The desktop launcher keeps running even if the rebuild fails, but vector memory is temporarily disabled and a warning is written to the Electron console and `data/electron.log`.

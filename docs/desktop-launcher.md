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
- Live log viewer that tails new entries from `data/messages.log` and surfaces Electron lifecycle events through the **Desktop**
  filter for easier debugging.
- Pause, clear, and per-source filters plus optional auto-scroll for logs.
- Toolbar font size controls (small/medium/large) for the log viewer to improve readability.
- Desktop lifecycle events are also saved to `data/electron.log`, providing a plain-text audit trail for troubleshooting startup
  issues even if the renderer UI is unavailable.
- Graceful shutdown of Telegram bots and MQTT subscriptions when quitting.

## Packaging

### Windows `.exe`

```bash
npm run build:dist
```

The command bundles `electron/main.ts` and `electron/preload.js`, then invokes `electron-builder` to emit an `.exe` installer in
the `dist/` directory. Drop your own icon at `electron/assets/icon.png` before packaging.

### Custom workflows

If you need just the compiled JavaScript entry points (for example to feed another packager), run:

```bash
npm run build:electron
```

The bundled files are written to `dist-electron/`.

> **Tip:** Add your own tray icon at `electron/assets/icon.png` before packaging; the repository intentionally leaves the placeholder untracked.

## Native modules

The vector memory tools depend on the `better-sqlite3` native module. When you launch Electron it uses its own Node.js build, so you must rebuild the binding to match and then explicitly opt-in to loading it inside the desktop shell:

```bash
npx electron-rebuild --only better-sqlite3
BETTER_SQLITE3_ALLOW_ELECTRON=1 npm run desktop
```

Until both steps are completed the desktop launcher skips the native module to avoid `NODE_MODULE_VERSION` errors. Vector memory remains disabled and a warning is written to the Electron console and `data/electron.log`.

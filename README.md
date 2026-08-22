# Vibe Linux

A 100% client-side, Ubuntu/GNOME-inspired Linux desktop simulation built with React, TypeScript, Vite, Tailwind CSS, Zustand, and IndexedDB.

## Features

- Ubuntu/GNOME-inspired desktop UI
- Top taskbar with Activities menu, running apps, clock, Wi-Fi, battery and power icons
- Desktop icons and right-click context menu
- Multi-window manager
  - drag
  - resize
  - minimize
  - maximize/restore
  - close
  - focus/z-index handling
- Browser-only virtual filesystem stored in IndexedDB
- Terminal connected to the same virtual filesystem
  - `ls`
  - `cd`
  - `pwd`
  - `mkdir`
  - `touch`
  - `cat`
  - `rm`
  - `echo`
  - `clear`
  - `help`
  - extras: `whoami`, `date`, `uname`, `neofetch`
- File Manager
  - browse folders
  - create files/folders
  - rename
  - delete
  - open text files in the editor
- Text Editor
  - open files by path
  - edit and save files back to IndexedDB
- Settings
  - dark/light theme
  - wallpaper presets
  - reset virtual filesystem
- Calculator
- Simple iframe browser

> This project simulates a Linux desktop. It does not run a real Linux kernel, native Linux binaries, `apt`, `systemd`, or arbitrary host commands.

## Local development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Deploy to Cloudflare Workers

This repository is configured for **Workers Static Assets** using `wrangler.jsonc`.

### Recommended Cloudflare dashboard / GitHub integration settings

1. Open Cloudflare Dashboard.
2. Go to **Workers & Pages**.
3. Create/import a Worker from GitHub.
4. Select `Tdotcoperation/vibe-Linux`.
5. Root directory: repository root (`/`).
6. Build command: `npm run build`
7. Deploy command: `npx wrangler deploy`
8. Deploy.

Cloudflare may automatically use Bun for dependency installation. This repository also has a root `postinstall` build hook, so `dist/` is generated after dependency installation even when the Cloudflare Build command is left empty. The explicit Build command above is still the recommended configuration.

If Cloudflare only gives you a single deploy-command field, use:

```bash
npm run deploy
```

The Wrangler configuration uploads `./dist` as Worker static assets and uses SPA fallback routing.

```jsonc
{
  "name": "vibe-linux",
  "compatibility_date": "2026-08-22",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

No D1, R2, KV, environment variables, API keys, or backend server are required.

## Storage

The virtual filesystem is saved in the visitor's browser using IndexedDB. Clearing site data or resetting the filesystem from Settings removes the virtual Linux files for that browser.

## Notes about the browser app

The included browser uses an `iframe`. Some sites refuse to load inside iframes because of `X-Frame-Options` or Content Security Policy. That is expected browser security behavior and is not a Vibe Linux error.

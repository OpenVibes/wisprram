# Development guide

How the repo is laid out, how to run and test each part, and how to build and release. For the architecture see [DESIGN.md](DESIGN.md); for contribution etiquette see [../CONTRIBUTING.md](../CONTRIBUTING.md).

## Repo layout

```text
wisprram/
  backend/                    Python server (FastAPI, faster-whisper, Ollama client)
    wisprram_server/          the package; routers/ has one module per API area
    tests/                    pytest; fixtures/ holds tiny speech clips
    scripts/                  install.sh, install-service.sh, run.sh, test.sh, bench.py
    systemd/                  systemd --user unit template
    pyproject.toml            extras: cuda (GPU libs), dev (pytest)
  client/                     Electron app (electron-vite, React, TypeScript)
    src/shared/               contracts shared by main, preload and renderer: api.ts, ipc.ts, settings.ts
    src/main/                 main process: windows, tray, hotkeys, recorder, paste, archive, API client
    src/preload/              contextBridge exposing window.wisprram
    src/renderer/             main window (index.html) and overlay pill (overlay.html); React code in src/
    src/renderer/src/mock/    browser-only mock of window.wisprram for UI work
    dev/mock-server.mjs       fake WisprRam server for developing the app without a GPU
    build/                    app icon, dmg background, make-icons.py
    resources/                tray icons
    electron-builder.yml      packaging config
  docs/                       documentation (you are here)
  site/                       the landing page (static HTML, CSS and JS; no build step)
  scripts/                    build-mac.sh, build-win-linux.sh
  .github/                    workflows (CI, Pages, release) and issue/PR templates
```

## Client

Needs Node 22 or newer.

```bash
cd client
npm ci
```

`npm ci` installs Electron and the native `uiohook-napi` prebuilds. `package.json` lists them under `allowScripts`; newer npm versions use that list to decide which install scripts may run, and older ones ignore it and simply run them.

### Dev loops

| Command | What it gives you |
|---|---|
| `npm run ui:mock` | The whole UI in a plain browser at <http://localhost:5199> with a mock `window.wisprram` bridge and sample data. Fast, hot reload, no Electron, no server. The overlay is at `/overlay.html#recording` (also `#processing`, `#done`, `#error`, `#handsfree`, `#command`). Query flags: `?theme=light` or `?theme=dark`, `?unpaired=1`. |
| `node dev/mock-server.mjs` | A fake WisprRam backend on <http://127.0.0.1:8791> (override with `PORT` and `HOST`). Pairing code `123456`; token `mock-token-for-dev-only`. Lets you run the real app without the GPU server. |
| `npm run dev` | The real Electron app with hot reload. Point it at the mock server or a real one. Use `WISPRRAM_USER_DATA=/some/dir` to keep a throwaway settings folder. |

A typical loop for main-process work: terminal 1 `node dev/mock-server.mjs`, terminal 2 `npm run dev`, then pair with `http://127.0.0.1:8791` and code `123456`.

On macOS the dev Electron binary needs the same permissions as the packaged app (Microphone, Accessibility, Input Monitoring), granted to your terminal or to "Electron".

### Checks

```bash
npm run typecheck           # tsc for node (main/preload) and web (renderer) projects
npx vitest run              # unit tests
npx electron-vite build     # production bundle into client/out
```

These are exactly what CI runs.

### Shared contracts

`src/shared/api.ts` mirrors the server's wire types, `ipc.ts` defines the IPC channels and the `WisprramBridge` interface that the renderer uses, `settings.ts` defines the client settings and defaults. Change them carefully: they are the seams between processes and between client and server. Add new fields as **optional** so older apps and servers keep working together.

## Server

```bash
cd backend
./scripts/install.sh --dev          # venv + deps (+ pytest); add --cpu on machines without NVIDIA
./scripts/run.sh serve              # run it
./scripts/run.sh doctor             # environment checklist
```

Or by hand without any GPU libraries, which is all the unit tests need:

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

### Tests

```bash
./scripts/test.sh -m "not integration"     # unit and API tests: seconds, no GPU, no models, no Ollama
./scripts/test.sh -m integration           # real-audio tests: need the Whisper model and Ollama
# equivalent: .venv/bin/pytest -m "not integration"
```

The API tests drive the FastAPI app with fake STT and LLM backends. The integration tests run the real pipeline on small speech fixtures in `tests/fixtures/`. `scripts/bench.py` measures end-to-end latency against a running server.

## Building installers

Version comes from `client/package.json` (`npm version` it, or edit it, and keep `backend/pyproject.toml` and `wisprram_server/config.py` in step for a release). Output goes to `client/release/<version>/`.

### macOS dmg (on a Mac)

```bash
scripts/build-mac.sh        # electron-vite build + electron-builder --mac --arm64
```

The app is ad-hoc signed (`identity: "-"` in `electron-builder.yml`) because an unsigned arm64 binary is killed by macOS. There is no Developer ID and no notarization, hence the `xattr` step for users.

### Windows exe and Linux deb and AppImage

On any machine with Docker:

```bash
scripts/build-win-linux.sh
```

This runs `electron-builder` inside `electronuserland/builder:wine` (set `WR_BUILDER_IMAGE` to use another image), caching Electron downloads in a named Docker volume. It builds `WisprRam-Setup-<version>.exe`, `wisprram_<version>_amd64.deb` and `WisprRam-<version>-x86_64.AppImage`. The first run downloads a few GB.

Nothing is ever published from a local build: both scripts pass `--publish never`.

### Icons

The app icon is `client/build/icon.png` (1024 px). `build/make-icons.py` regenerates the icon and the dmg background (needs Pillow); tray icons are in `client/resources/tray/`.

## Releasing

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)).

1. Update the version in `client/package.json`, `backend/pyproject.toml` and `backend/wisprram_server/config.py` (`VERSION`), and move the "Unreleased" notes in [CHANGELOG.md](../CHANGELOG.md) under the new version.
2. Merge to `main`, make sure CI is green.
3. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The workflow checks that the tag matches `client/package.json`, builds the dmg on a macOS arm64 runner, the exe on Windows, and the deb and AppImage on Ubuntu, and attaches them to a **draft** GitHub Release named after the tag with generated release notes.
5. Review the draft, edit the notes, publish it. The website's download buttons read the latest published release automatically.

No signing secrets are involved. If you add code signing later, put the certificates in repository secrets and extend the workflow.

## Landing page

`site/` is static: `index.html`, `style.css`, `app.js`, `config.js` and `assets/`. There is no build step. Preview it with any static server:

```bash
cd site && python3 -m http.server 8000
```

The GitHub owner and repository are set in **one place**, `site/config.js`; the download buttons, GitHub links and star button read it. The workflow [`pages.yml`](../.github/workflows/pages.yml) deploys the folder to GitHub Pages on pushes to `main` that touch `site/`.

Screenshots in `site/assets/` and `docs/images/` come from the mock UI (`npm run ui:mock`) captured with headless Chrome, for example:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1100,720 --screenshot=home.png 'http://localhost:5199/#/home'
```

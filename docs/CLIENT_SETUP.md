# App setup

The WisprRam app is a small Electron application for macOS, Windows and Linux. It records your voice, sends it to your [WisprRam server](SERVER_SETUP.md) and pastes the result into the app you are using. Set up and [pair](SERVER_SETUP.md#pairing) the server first; you need its URL (for example `http://192.168.1.50:8790`) and a 6-digit pairing code from `./scripts/run.sh pair`.

## Download

Get the installer for your system from the [latest release](https://github.com/OpenVibes/wisprram/releases/latest) or from the [website](https://openvibes.github.io/wisprram/), which picks the right one for you.

| OS | File |
|---|---|
| macOS (Apple Silicon) | `WisprRam-<version>-arm64.dmg` |
| Windows 10/11 x64 | `WisprRam-Setup-<version>.exe` |
| Linux x64 (Debian, Ubuntu) | `wisprram_<version>_amd64.deb` |
| Linux x64 (any distro) | `WisprRam-<version>-x86_64.AppImage` |

The installers are **not code-signed**, so each OS shows a one-time warning. Download only from this project's GitHub releases.

## macOS

1. Open the `.dmg` and drag **WisprRam** onto **Applications**.
2. The app is ad-hoc signed but not notarized, so Gatekeeper blocks the first launch. Remove the quarantine flag once:
   ```bash
   xattr -dr com.apple.quarantine /Applications/WisprRam.app
   ```
   Alternatives: right-click the app, choose **Open**, then **Open** again; or System Settings, **Privacy & Security**, scroll down and click **Open Anyway**.
3. Launch WisprRam and follow the onboarding (below). macOS will ask for the permissions in the next section.
4. Quit and reopen WisprRam after granting Accessibility and Input Monitoring so they take effect.

### macOS permissions

All of them are in **System Settings, Privacy & Security**:

| Permission | Where | Why |
|---|---|---|
| **Microphone** | Privacy & Security, Microphone | Recording. Asked automatically on the first recording. |
| **Accessibility** | Privacy & Security, Accessibility | Pasting into the active app (simulated Cmd+V) and reading the selection in command mode. |
| **Input Monitoring** | Privacy & Security, Input Monitoring | Detecting the hold-to-talk key (Right Option) while another app has focus. |
| **Automation** (System Events) | Privacy & Security, Automation | Asked the first time the app looks up the frontmost app (for per-app styles) and to paste. Allow it. |

Click the **+** button in the list and pick `/Applications/WisprRam.app` if it is not listed.

**After every update you must re-grant Accessibility and Input Monitoring.** The ad-hoc signature changes with each build, so macOS treats the new app as a different program. In System Settings remove the old WisprRam entry (select it, press **-**), add it again and enable it, then restart WisprRam. If a toggle looks on but nothing is pasted, this is the cause.

Upgrading: replace `/Applications/WisprRam.app` and run the `xattr` command again.

## Windows

1. Run `WisprRam-Setup-<version>.exe`.
2. SmartScreen shows "Windows protected your PC" because the installer is unsigned. Click **More info**, then **Run anyway**.
3. Pick the install folder. The default is per user (`%LOCALAPPDATA%\Programs\WisprRam`) and needs no administrator rights. Desktop and Start-menu shortcuts are created.
4. If Windows asks for microphone access, allow it (Settings, **Privacy & security**, **Microphone**, allow desktop apps).

The default hold-to-talk key is **Right Ctrl**. If hold-to-talk or pasting does nothing in an app that runs as administrator, start WisprRam as administrator too: Windows does not let normal programs type into elevated ones.

Uninstall from Settings, **Apps**. Your settings stay in `%APPDATA%\WisprRam` unless you delete them.

## Linux

### .deb (Debian, Ubuntu)

```bash
sudo apt install ./wisprram_<version>_amd64.deb
sudo apt install wtype xdotool      # optional but recommended, for pasting
```

`apt` pulls in the runtime libraries (GTK 3, NSS, libXtst and others). Start it from the application menu ("WisprRam") or run `wisprram`.

### AppImage (any distro)

```bash
chmod +x WisprRam-<version>-x86_64.AppImage
./WisprRam-<version>-x86_64.AppImage
```

On Ubuntu 24.04 and newer AppImages need FUSE 2 (`sudo apt install libfuse2t64`), or run with `--appimage-extract-and-run`. If Chromium's sandbox complains, add `--no-sandbox`.

### X11 and Wayland

- **X11 session** (for example "Ubuntu on Xorg"): everything works, including hold-to-talk.
- **Wayland session** (the default on recent Ubuntu and Fedora): the compositor does not let apps watch global key presses, so **hold-to-talk only works while an XWayland app has focus**. Use the **hands-free shortcut** (Ctrl+Shift+Space), which is registered through the desktop portal; GNOME may ask you to confirm it the first time. Command mode (Ctrl+Shift+E) is a normal global shortcut and uses the same portal.
- **Pasting on Wayland:** install `wtype` (works on wlroots compositors and recent GNOME) or `ydotool` (needs its daemon running and access to `/dev/uinput`). If the paste keystroke cannot be injected, WisprRam leaves the text on the clipboard and tells you to press **Ctrl+V**. On X11 `xdotool` is used.
- The microphone comes from PipeWire or PulseAudio; choose the input in **Settings, Microphone**.

## First run (onboarding)

The first time you open WisprRam a short wizard runs:

1. **Welcome**.
2. **Connect**: enter your server URL and the pairing code. The app shows the server's GPU and models when it connects. The URL is editable later in Settings, which helps when the server's IP changes.
3. **Microphone**: pick the input device and watch the level meter while you speak.
4. **Permissions** (macOS): grant Accessibility and Input Monitoring as described above.
5. **Recordings and archive**: optionally keep a local copy of every dictation (off by default). See [ARCHIVE.md](ARCHIVE.md).
6. **Try it**: hold the talk key and say something; the text is inserted where the cursor is.

You can repeat any of this later from **Settings**.

## Using it

| Action | macOS | Windows / Linux |
|---|---|---|
| Hold to talk, release to insert | Hold **Right Option** | Hold **Right Ctrl** |
| Lock hands-free | Double-tap the talk key | Double-tap the talk key |
| Hands-free on or off | **Cmd+Shift+Space** | **Ctrl+Shift+Space** |
| Command mode: select text, press, speak an instruction | **Cmd+Shift+E** | **Ctrl+Shift+E** |
| Cancel | **Esc** | **Esc** |

Quick taps shorter than a quarter of a second are ignored, so a stray press does nothing. All shortcuts are changeable in **Settings, Hotkeys**.

Pages in the app: **Home** (connection, hotkey hints, stats), **History** (search, copy, replay if the server kept audio, save to archive), **Dictionary** (names and jargon), **Snippets** (say a trigger, get a block of text), **Style** (cleanup level, default style, per-app styles), **Settings**. The app lives in the menu bar or system tray; closing the window keeps it running there.

Cleanup levels: **none** (raw transcript), **light** (instant rule-based tidy-up), **full** (rules plus the LLM; best quality).

## Where settings and logs live

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/WisprRam` |
| Windows | `%APPDATA%\WisprRam` |
| Linux | `~/.config/WisprRam` |

Inside: `settings.json`, the encrypted pairing token, and `logs/main.log` (kept below 1 MB). The local archive is separate and lives in the folder you chose, `<Documents>/WisprRam` by default. To reset the app, quit it and delete the folder above.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach server" | Check the URL and port, that the server is running (`curl http://<ip>:8790/health` from this computer) and the server's firewall. See [SERVER_SETUP.md](SERVER_SETUP.md#troubleshooting). |
| Hold-to-talk does nothing (macOS) | Grant **Input Monitoring** and **Accessibility**, then restart the app; re-add them after an update. |
| Text is recorded but not pasted (macOS) | **Accessibility** is missing or stale (see above). The text is still on the clipboard; press Cmd+V. |
| Hold-to-talk does nothing (Linux) | You are on Wayland: use the hands-free shortcut or log in with an X11 session. |
| Wrong microphone | Settings, Microphone. |
| Recording works but the text is empty | Nothing intelligible was heard. Check the level meter in Settings, Microphone. |
| First dictation after a break is slow | The server is reloading the LLM; later ones are fast. |

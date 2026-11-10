# Changelog

All notable changes to WisprRam are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.2.0]

### Added
- **Local archive** (app): save every dictation and command on your own computer in a folder you choose, as `YYYY-MM-DD/HHMMSS-<kind>-<id8>/` with `audio.webm`, `transcript.txt`, `input.txt`, `output.txt` and `meta.json`, plus an `index.jsonl` at the root. Each part can be toggled, failed requests still save the audio, and history items can be saved later with "Save to archive". See [docs/ARCHIVE.md](docs/ARCHIVE.md).
- **Server audio retention** (server): `save_audio` and `audio_dir` settings keep recordings next to the history so they can be replayed from History on any device. New routes `GET /v1/history/{id}` and `GET /v1/history/{id}/audio`; deleting or pruning history deletes the audio.
- **Installer script** `backend/scripts/install.sh`: checks Python and GPU, installs the CUDA or CPU extras, pulls the Ollama model, runs `wisprram-server doctor`, installs a systemd user service and prints the LAN URL, firewall commands and pairing steps.
- **Documentation**: new README, server and app setup guides, API reference, archive guide, development guide, design document, security policy and contributing guide.
- **Landing page** at <https://openvibes.github.io/wisprram/> with OS-aware download buttons.
- **CI/CD**: GitHub Actions for tests, Pages deployment and tagged releases (dmg, exe, deb, AppImage).

### Changed
- `PLAN.md` became [docs/DESIGN.md](docs/DESIGN.md), rewritten as a general architecture document.
- Build scripts no longer depend on a specific machine; `scripts/build-win-linux.sh` builds in local Docker.
- The server URL field starts empty instead of suggesting an address.

## [0.1.0]

Initial release.

- Server: FastAPI with faster-whisper `large-v3-turbo` (CUDA float16, CPU int8 fallback) and Ollama `qwen2.5:3b` cleanup with rule-based fallback; history and stats in SQLite; dictionary, snippets, pairing codes and bearer tokens; `systemd --user` unit.
- App (Electron): push-to-talk, hands-free and command mode, overlay pill, AI cleanup levels and styles with per-app overrides, personal dictionary, snippets, history, stats, onboarding and pairing.
- Installers: macOS arm64 dmg (ad-hoc signed), Windows x64 exe, Linux deb and AppImage.

[0.2.0]: https://github.com/OpenVibes/wisprram/releases/tag/v0.2.0
[0.1.0]: https://github.com/OpenVibes/wisprram/releases/tag/v0.1.0

# Contributing to WisprRam

Thanks for helping. WisprRam is a small project with two halves: a Python server in `backend/` and an Electron app in `client/`. The full developer guide is [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); this page is the short version.

## Ways to help

- **Report a bug** with the [bug template](https://github.com/OpenVibes/wisprram/issues/new?template=bug.yml). Include your OS, the app and server versions, and what `wisprram-server doctor` prints.
- **Suggest a feature** with the [feature template](https://github.com/OpenVibes/wisprram/issues/new?template=feature.yml). Describing the problem first helps more than describing a solution.
- **Improve the docs**: typos, missing steps for your distro, clearer wording. Doc-only pull requests are very welcome.
- **Send code.** For anything bigger than a small fix please open an issue first so we can agree on the approach.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Getting set up

```bash
git clone https://github.com/OpenVibes/wisprram && cd wisprram

# App (Node 22 or newer)
cd client && npm ci
npm run ui:mock          # whole UI in a browser with a fake backend, http://localhost:5199
npm run dev              # the real Electron app (needs a server, or: node dev/mock-server.mjs)

# Server (Python 3.10 to 3.12, no GPU needed for the unit tests)
cd ../backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -m "not integration"
```

## Before you open a pull request

Run what CI runs:

```bash
cd client && npm run typecheck && npx vitest run && npx electron-vite build
cd ../backend && pytest -m "not integration"
```

- Keep pull requests focused: one change, with tests where it makes sense.
- Follow the style of the surrounding code. TypeScript is strict; the server uses type hints.
- The HTTP API is additive: new fields must be optional so old apps keep working with new servers and vice versa. Update `client/src/shared/api.ts`, [docs/API.md](docs/API.md) and the tests together.
- Update [CHANGELOG.md](CHANGELOG.md) under an "Unreleased" heading for user-visible changes.
- Do not commit personal data: IP addresses, hostnames, tokens, recordings.

## Commit messages

Short imperative subject ("Add archive toggle for transcripts"), details in the body if needed. No special format is required.

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/OpenVibes/wisprram/security/advisories/new>). If that is not available to you, open an issue that only says you have a security report to share (no details), and a maintainer will set up a private channel.

Please include what you found, how to reproduce it, the affected versions and, if you have one, a suggested fix. You will get an acknowledgement within a few days. This is a volunteer project, so fixes are best-effort, but security reports are handled first.

Supported versions: the latest release.

## Threat model

WisprRam is built for **one person or a small household** running the server on a **trusted home or office network**. It is not designed to be exposed to the internet.

| Asset | How it is protected | Residual risk |
|---|---|---|
| Audio and transcripts in transit | Plain **HTTP**, no TLS. Anyone who can sniff your LAN (shared Wi-Fi, a compromised router or device) can read and replay traffic. | Use only on networks you trust, or tunnel through Tailscale or WireGuard, which encrypt traffic. |
| Access to the server | **Bearer tokens**: 32 random bytes, stored only as SHA-256 hashes on the server; encrypted at rest on the client with the OS keychain when available (`safeStorage`). | A stolen token gives full API access until you revoke it (`wisprram-server token --list`). |
| Pairing | A **6-digit code**, valid 10 minutes, single use, rate limited (429 after repeated wrong tries). The code is only shown to someone with shell access on the server. | Someone on your LAN who is quick could guess a code during the pairing window; the rate limit makes this impractical but not impossible. Only run `pair` when you are about to pair. |
| History and kept audio on the server | A SQLite file (mode 0600) and audio files in the server user's data directory. Not encrypted at rest. | Anyone with access to the server account or disk can read them. Use full-disk encryption if that matters. Delete history to delete the audio. |
| Local archive on the client | Plain files in the folder you choose. | Same as any file in your Documents folder. |
| Ollama | Listens on `127.0.0.1` by default and is only called by the server. | Do not expose port 11434. |

Other points:

- The server has **no user accounts**: all paired apps share the same history, dictionary and settings.
- The LLM sees your transcripts. It runs locally, but a prompt-injection in the audio ("ignore previous instructions...") could change the cleaned text. The prompt treats transcripts as data and length guards limit the effect, and the output is only ever pasted as text, never executed.
- The apps are **unsigned**. Download them only from the GitHub releases page or build them yourself, and verify the release comes from this repository.
- The Electron renderer runs with context isolation; it reaches the network only through the main process.

## Hardening checklist

- Allow port 8790 only from your LAN in the firewall (`ufw allow from 192.168.1.0/24 ...`), never from the internet.
- For use outside the home, install Tailscale or WireGuard and point the app at the VPN address. Do not port-forward 8790.
- Run `pair` only when pairing, and revoke tokens of devices you no longer use.
- Keep the server's OS, Python packages and Ollama updated (`git pull && ./scripts/install.sh`).
- Put `audio_dir` and the data directory on an encrypted disk if you keep recordings.

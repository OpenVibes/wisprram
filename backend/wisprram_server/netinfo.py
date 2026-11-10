"""Best-effort discovery of this machine's LAN addresses (for pairing hints)."""
from __future__ import annotations

import shutil
import socket
import subprocess

# Virtual interfaces that are never what you type into the app (Docker, libvirt, Kubernetes, ...).
_VIRTUAL = ("docker", "br-", "virbr", "veth", "lxc", "lxd", "cni", "flannel", "cali", "podman", "vmnet", "vboxnet")


def _run(cmd: list[str]) -> str:
    if not shutil.which(cmd[0]):
        return ""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=2).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def lan_ips() -> list[str]:
    """Non-loopback IPv4 addresses of real interfaces, the default-route one first. Empty if none found."""
    ips: list[str] = []
    try:  # a UDP "connect" sends nothing; it just asks the kernel which address would be used
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    listed = False
    for line in _run(["ip", "-4", "-o", "addr", "show", "scope", "global"]).splitlines():
        parts = line.split()  # "2: wlp0s20f3  inet 10.0.0.5/24 brd ..."
        if len(parts) >= 4 and parts[2] == "inet":
            listed = True
            if not parts[1].startswith(_VIRTUAL):
                ips.append(parts[3].split("/")[0])
    if not listed:
        ips += _run(["hostname", "-I"]).split()
    seen: list[str] = []
    for ip in ips:
        if ip.count(".") == 3 and not ip.startswith(("127.", "0.", "169.254.")) and ip not in seen:
            seen.append(ip)
    return seen

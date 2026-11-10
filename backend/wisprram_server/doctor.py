"""`wisprram-server doctor`: a checklist of everything the server needs, with a fix for each problem."""
from __future__ import annotations

import ctypes
import importlib
import os
import platform
import shutil
import socket
import subprocess
import sys

from .config import VERSION, Config
from .netinfo import lan_ips

_MODEL_SIZES = {"large-v3-turbo": "1.6 GB", "large-v3": "3.1 GB", "large-v2": "3.1 GB", "medium": "1.5 GB",
                "small": "0.5 GB", "base": "0.15 GB", "tiny": "0.08 GB"}


class Report:
    def __init__(self) -> None:
        enc = (getattr(sys.stdout, "encoding", None) or "").lower()
        utf = "utf" in enc
        color = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
        self._sym = {
            "ok": ("✓" if utf else "[ok]", "32"),
            "warn": ("!" if utf else "[warn]", "33"),
            "fail": ("✗" if utf else "[FAIL]", "31"),
        }
        self._color = color
        self.fails = 0
        self.warns = 0

    def _line(self, kind: str, label: str, detail: str = "", fix: str | list[str] | None = None) -> None:
        sym, col = self._sym[kind]
        if self._color:
            sym = f"\033[{col}m{sym}\033[0m"
        print(f"  {sym} {label}" + (f": {detail}" if detail else ""))
        for f in ([fix] if isinstance(fix, str) else fix or []):
            print(f"      fix: {f}")

    def ok(self, label, detail=""):
        self._line("ok", label, detail)

    def warn(self, label, detail="", fix=None):
        self.warns += 1
        self._line("warn", label, detail, fix)

    def fail(self, label, detail="", fix=None):
        self.fails += 1
        self._line("fail", label, detail, fix)

    def section(self, title: str) -> None:
        print(f"\n{title}")


def _gpu() -> dict | None:
    from .gpu import gpu_info

    return gpu_info(0)


def _cuda_devices() -> int:
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count())
    except Exception:  # noqa: BLE001
        return 0


def pick_stt_model(cfg: Config, configured: str | None = None) -> str:
    """The model the server will actually load on this machine."""
    if cfg.stt_device != "cpu" and _cuda_devices() > 0:
        return configured or cfg.stt_model
    return cfg.stt_cpu_model


def _check_python(r: Report) -> None:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if v < (3, 10):
        r.fail(f"Python {ver}", "too old", "install Python 3.10-3.12 (or `uv`, which fetches one for you)")
    elif v >= (3, 13):
        r.warn(f"Python {ver}", "untested; 3.10-3.12 is the supported range", "recreate the venv with Python 3.12")
    else:
        r.ok(f"Python {ver}")
    sysname = platform.system()
    if sysname == "Linux" and platform.machine() in ("x86_64", "AMD64"):
        r.ok("Platform", "Linux x86_64 (supported)")
    else:
        r.warn("Platform", f"{sysname} {platform.machine()}: best effort, CPU only",
               "Linux x86_64 with an NVIDIA GPU is the supported setup")


def _check_deps(r: Report) -> None:
    for mod, label in (("faster_whisper", "faster-whisper"), ("ctranslate2", "CTranslate2"), ("av", "PyAV"),
                       ("fastapi", "FastAPI"), ("uvicorn", "uvicorn")):
        try:
            m = importlib.import_module(mod)
            ver = getattr(m, "__version__", "")
            if mod == "av" and int(ver.split(".")[0]) >= 17:
                r.fail(f"{label} {ver}", "faster-whisper needs PyAV < 17", "pip install 'av>=14,<17'")
            else:
                r.ok(f"{label} {ver}".strip())
        except Exception as exc:  # noqa: BLE001
            r.fail(label, f"import failed: {exc}", "reinstall: scripts/install.sh")


def _check_gpu(r: Report, cfg: Config) -> bool:
    """Returns True if the server will run the speech model on CUDA."""
    g = _gpu()
    if cfg.stt_device == "cpu":
        r.ok("Device", "WISPRRAM_STT_DEVICE=cpu: running on CPU by choice")
        return False
    if not g:
        r.warn("NVIDIA GPU", "nvidia-smi not found or no GPU: using CPU mode (small model, slower)",
               "with an NVIDIA GPU: install the driver (`nvidia-smi` must work), then re-run scripts/install.sh")
        return False
    gb = g["mem_total_mb"] / 1024
    r.ok("NVIDIA GPU", f"{g['name']}, {g['mem_used_mb']}/{g['mem_total_mb']} MiB used")
    if gb < 5.5:
        r.warn("GPU memory", f"{gb:.1f} GB is tight for large-v3-turbo + the LLM (about 5 GB)",
               "WISPRRAM_STT_COMPUTE_TYPE=int8_float16 or WISPRRAM_STT_MODEL=small")
    missing = []
    for lib in ("libcublas.so.12", "libcudnn.so.9"):
        try:
            ctypes.CDLL(lib)
            r.ok(f"load {lib}")
        except OSError:
            missing.append(lib)
            r.warn(f"load {lib}", "not found",
                   ["install the wheels: .venv/bin/pip install 'nvidia-cublas-cu12' 'nvidia-cudnn-cu12==9.*'  "
                    "(or: pip install -e '.[cuda]')",
                    "always start the server through scripts/run.sh, which adds them to LD_LIBRARY_PATH"])
    n = _cuda_devices()
    if n > 0:
        r.ok("CTranslate2 CUDA", f"{n} device(s)")
    else:
        r.warn("CTranslate2 CUDA", "no device visible: the server will fall back to CPU",
               "check `nvidia-smi`, and that this was started via scripts/run.sh")
    return n > 0 and not missing


def _check_models(r: Report, cfg: Config, on_cuda: bool, stt_model: str) -> None:
    from .stt import model_cached

    name = stt_model if on_cuda else cfg.stt_cpu_model
    size = _MODEL_SIZES.get(name, "?")
    if model_cached(name):
        r.ok(f"Speech model {name}", "downloaded")
    else:
        r.warn(f"Speech model {name}", f"not downloaded yet (~{size}); the first start downloads it (progress in the log)",
               "pre-download now: scripts/run.sh fetch-model")
    try:
        hf = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
        os.makedirs(hf, exist_ok=True)
        free = shutil.disk_usage(hf).free / 1e9
        if free < 6:
            r.warn("Disk space", f"{free:.1f} GB free where models are stored ({hf})",
                   "models need ~5 GB; free some space or set HF_HOME / OLLAMA_MODELS elsewhere")
        else:
            r.ok("Disk space", f"{free:.0f} GB free for models")
    except OSError:
        pass


def _check_ollama(r: Report, cfg: Config, llm_model: str) -> None:
    import httpx

    try:
        resp = httpx.get(cfg.ollama_url.rstrip("/") + "/api/tags", timeout=3)
        resp.raise_for_status()
        names = [m["name"] for m in resp.json().get("models", [])]
    except Exception as exc:  # noqa: BLE001
        have_cli = shutil.which("ollama")
        fix = (["start it: `ollama serve` (or `systemctl start ollama`)",
                f"if it runs elsewhere, set WISPRRAM_OLLAMA_URL (now {cfg.ollama_url})"] if have_cli else
               ["install Ollama: curl -fsSL https://ollama.com/install.sh | sh",
                f"then: ollama pull {llm_model}"])
        r.warn("Ollama", f"not reachable at {cfg.ollama_url} ({type(exc).__name__}); text cleanup falls back to "
               "rules-only", fix)
        return
    r.ok("Ollama reachable", cfg.ollama_url)
    want = llm_model if ":" in llm_model else llm_model + ":latest"
    if want in names or llm_model in names:
        r.ok(f"Ollama model {llm_model}", "present")
    else:
        r.warn(f"Ollama model {llm_model}", "not pulled; text cleanup falls back to rules-only until it is",
               f"ollama pull {llm_model}")


def _http_health(port: int) -> dict | None:
    import httpx

    try:
        j = httpx.get(f"http://127.0.0.1:{port}/health", timeout=2).json()
        return j if isinstance(j, dict) and "stt" in j else None
    except Exception:  # noqa: BLE001
        return None


def _check_port(r: Report, cfg: Config) -> None:
    s = socket.socket()
    try:
        if os.name != "nt":
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((cfg.host, cfg.port))
        r.ok(f"Port {cfg.port}", f"free on {cfg.host}")
    except OSError:
        j = _http_health(cfg.port)
        if j:
            r.ok(f"Port {cfg.port}", f"WisprRam {j.get('version', '?')} is already running here "
                 f"(stt loaded={j['stt'].get('loaded')})")
        else:
            r.fail(f"Port {cfg.port}", "in use by something else",
                   f"pick another: WISPRRAM_PORT=8791 scripts/run.sh serve  (find the owner: ss -ltnp 'sport = :{cfg.port}')")
    finally:
        s.close()


def _check_data(r: Report, cfg: Config) -> None:
    from .audio_store import AudioStore
    from .db import Database

    if os.access(cfg.data_dir, os.W_OK):
        r.ok("Data dir writable", str(cfg.data_dir))
    else:
        r.fail("Data dir writable", f"{cfg.data_dir} is not writable",
               "fix permissions or set WISPRRAM_DATA_DIR to a folder you own")
        return
    try:
        db = Database(cfg.db_path)
        db.list_tokens()
        r.ok("Database", str(cfg.db_path))
    except Exception as exc:  # noqa: BLE001
        r.fail("Database", str(exc), f"move {cfg.db_path} aside if it is corrupt (it is recreated on start)")
        return
    store = AudioStore(cfg, db)
    adir = store.directory
    state = "on" if store.enabled else "off"
    probe = adir
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    if os.access(probe, os.W_OK):
        r.ok("Audio dir writable", f"{adir} (keeping recordings: {state})")
    elif store.enabled:
        r.fail("Audio dir writable", f"{adir} is not writable", "PUT /v1/settings {\"audio_dir\": \"/some/writable/dir\"}")
    else:
        r.warn("Audio dir writable", f"{adir} is not writable (only matters if you turn on save_audio)")
    db.close()


def _check_firewall(r: Report, cfg: Config) -> None:
    if cfg.host in ("127.0.0.1", "localhost", "::1"):
        r.ok("Network", f"listening on {cfg.host} only (this machine)")
        return
    ips = lan_ips()
    where = ", ".join(f"http://{ip}:{cfg.port}" for ip in ips) or "(no LAN address found)"
    r.ok("LAN address(es) for the app", where)
    if sys.platform != "linux":
        return

    def active(unit: str) -> bool:
        if not shutil.which("systemctl"):
            return False
        try:
            return subprocess.run(["systemctl", "is-active", "--quiet", unit], timeout=3).returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    subnet = (ips[0].rsplit(".", 1)[0] + ".0/24") if ips else "192.168.1.0/24"
    if active("ufw"):
        r.warn("Firewall (ufw)", f"active; other devices can reach port {cfg.port} only if allowed",
               f"sudo ufw allow from {subnet} to any port {cfg.port} proto tcp   (adjust the subnet to your LAN)")
    elif active("firewalld"):
        r.warn("Firewall (firewalld)", f"active; other devices can reach port {cfg.port} only if allowed",
               [f"sudo firewall-cmd --permanent --add-port={cfg.port}/tcp", "sudo firewall-cmd --reload"])
    else:
        r.ok("Firewall", "no active ufw/firewalld detected")


def run(cfg: Config) -> int:
    from .db import Database

    r = Report()
    print(f"WisprRam server {VERSION} - doctor")
    r.section("Python")
    _check_python(r)
    _check_deps(r)
    r.section("Speech-to-text")
    on_cuda = _check_gpu(r, cfg)
    stt_model = cfg.stt_model
    llm_model = cfg.llm_model
    try:  # settings changed through the API win over the environment
        if cfg.db_path.exists():
            db = Database(cfg.db_path)
            stt_model = db.get_setting("stt_model", stt_model)
            llm_model = db.get_setting("llm_model", llm_model)
            db.close()
    except Exception:  # noqa: BLE001
        pass
    _check_models(r, cfg, on_cuda, stt_model)
    r.section("Text cleanup (Ollama)")
    _check_ollama(r, cfg, llm_model)
    r.section("Server")
    _check_data(r, cfg)
    _check_port(r, cfg)
    _check_firewall(r, cfg)
    print()
    if r.fails:
        print(f"{r.fails} problem(s) must be fixed, {r.warns} warning(s).")
    elif r.warns:
        print(f"Ready to run, with {r.warns} warning(s) above (none are blocking).")
    else:
        print("All good.")
    return 1 if r.fails else 0

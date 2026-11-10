"""`wisprram-server serve|pair|token|doctor|fetch-model`."""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys

from . import auth
from .config import VERSION, Config, load_config
from .db import Database
from .netinfo import lan_ips


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for noisy in ("httpx", "httpx2", "httpcore", "huggingface_hub", "urllib3", "filelock", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)  # per-request/per-file chatter


def cmd_serve(args, cfg: Config) -> int:
    import uvicorn

    setup_logging()
    uvicorn.run(
        "wisprram_server.main:create_app", factory=True, host=args.host or cfg.host, port=args.port or cfg.port,
        log_level="info",
    )
    return 0


def cmd_pair(args, cfg: Config) -> int:
    db = Database(cfg.db_path)
    code, expires = auth.create_pairing_code(db)
    until = dt.datetime.fromtimestamp(expires).strftime("%H:%M:%S")
    print(f"Pairing code: {code}   (valid 10 minutes, until {until}, single use)")
    urls = [f"http://{ip}:{cfg.port}" for ip in lan_ips()] or [f"http://<this-machine's-address>:{cfg.port}"]
    print("In the WisprRam app, enter the server URL and this code:")
    for u in urls:
        print(f"  {u}")
    return 0


def cmd_token(args, cfg: Config) -> int:
    db = Database(cfg.db_path)
    if args.list:
        for t in db.list_tokens():
            last = dt.datetime.fromtimestamp(t["last_used_at"]).isoformat(" ", "seconds") if t["last_used_at"] else "never"
            print(f"{t['id'][:8]}  {t['client_name']:<24} created {dt.datetime.fromtimestamp(t['created_at']):%Y-%m-%d %H:%M}  last used {last}")
        return 0
    if args.new:
        print(auth.issue_token(db, args.name))
        return 0
    print("use --new or --list", file=sys.stderr)
    return 2


def cmd_doctor(args, cfg: Config) -> int:
    from . import doctor

    return doctor.run(cfg)


def cmd_config(args, cfg: Config) -> int:
    """Print the effective configuration (environment + server.toml + settings saved through the API)."""
    stt_model, llm_model, audio_dir = cfg.stt_model, cfg.llm_model, ""
    if cfg.db_path.exists():
        db = Database(cfg.db_path)
        stt_model = db.get_setting("stt_model", stt_model)
        llm_model = db.get_setting("llm_model", llm_model)
        audio_dir = db.get_setting("audio_dir", "") or str(cfg.default_audio_dir)
        db.close()
    values = {
        "host": cfg.host, "port": cfg.port, "data_dir": cfg.data_dir, "db_path": cfg.db_path,
        "stt_model": stt_model, "stt_cpu_model": cfg.stt_cpu_model, "stt_device": cfg.stt_device,
        "stt_compute_type": cfg.stt_compute_type, "llm_model": llm_model, "ollama_url": cfg.ollama_url,
        "llm_timeout_s": cfg.llm_timeout_s, "command_timeout_s": cfg.command_timeout_s,
        "audio_dir": audio_dir or cfg.default_audio_dir,
    }
    if args.key:
        if args.key not in values:
            print(f"unknown key {args.key!r}; known: {', '.join(values)}", file=sys.stderr)
            return 2
        print(values[args.key])
        return 0
    for k, v in values.items():
        print(f"{k} = {v}")
    return 0


def cmd_fetch_model(args, cfg: Config) -> int:
    """Download the speech model now (with progress), so the first server start is instant."""
    from .doctor import pick_stt_model
    from .stt import ensure_model, model_cached

    setup_logging()
    name = args.model or (cfg.stt_cpu_model if args.cpu else pick_stt_model(cfg))
    if model_cached(name):
        print(f"speech model {name}: already downloaded")
        return 0
    ensure_model(name, interactive=sys.stderr.isatty())
    ok = model_cached(name)
    print(f"speech model {name}: " + ("downloaded" if ok else "download FAILED (check your internet connection)"))
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="wisprram-server")
    p.add_argument("--version", action="version", version=VERSION)
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("serve", help="run the HTTP server")
    sp.add_argument("--host")
    sp.add_argument("--port", type=int)
    sub.add_parser("pair", help="print a 6-digit pairing code (valid 10 min)")
    tp = sub.add_parser("token", help="create or list API tokens")
    tp.add_argument("--new", action="store_true", help="print a new token")
    tp.add_argument("--list", action="store_true")
    tp.add_argument("--name", default="cli")
    sub.add_parser("doctor", help="check the environment and print how to fix problems")
    cp = sub.add_parser("config", help="print the effective configuration (or one value)")
    cp.add_argument("key", nargs="?")
    fp = sub.add_parser("fetch-model", help="download the speech model now (shows progress)")
    fp.add_argument("--cpu", action="store_true", help="fetch the small CPU model instead")
    fp.add_argument("--model", help="model name or Hugging Face repo (default: the one this machine will use)")
    args = p.parse_args(argv)
    cfg = load_config()
    handlers = {"serve": cmd_serve, "pair": cmd_pair, "token": cmd_token, "doctor": cmd_doctor,
                "fetch-model": cmd_fetch_model,
                "config": cmd_config}
    sys.exit(handlers[args.cmd](args, cfg))


if __name__ == "__main__":
    main()

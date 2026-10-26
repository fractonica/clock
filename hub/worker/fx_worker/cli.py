"""fx-worker: the Fractonica Hub embedding worker.

    fx-worker [run] --hub http://localhost:8787 --token fxh_…     # or FX_HUB / FX_TOKEN / the config file
    fx-worker login --hub http://localhost:8787 --code XXXX-XXXX  # redeem a pairing code, save the token
    fx-worker selftest                                            # load the model, check device + embeddings
    fx-worker bench                                               # timings on this machine
"""

from __future__ import annotations

import argparse
import logging
import os
import platform
import signal
import socket
import sys

from . import __version__, config

COMMANDS = ("run", "login", "selftest", "bench")


def _model_args(p: argparse.ArgumentParser):
    from .embedder import ALL_MODALITIES, MODEL_ID

    p.add_argument("--model", default=os.environ.get("FX_MODEL", MODEL_ID), help=f"default {MODEL_ID}")
    p.add_argument("--device", choices=["auto", "mps", "cpu", "cuda"], default=os.environ.get("FX_DEVICE", "auto"),
                   help="auto: MPS if it agrees with CPU fp32 on the self-check, else CPU")
    p.add_argument("--dtype", choices=["auto", "bf16", "fp32"], default=os.environ.get("FX_DTYPE", "auto"),
                   help="auto: bf16 on MPS if numerically sane, else fp32 (never fp16)")
    p.add_argument("--modalities", default=os.environ.get("FX_MODALITIES", ",".join(ALL_MODALITIES)),
                   help="encoders to load, e.g. text,image (saves memory); text is always loaded")
    p.add_argument("--no-selfcheck", action="store_true", help="skip the device self-check (trust --device/--dtype)")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="fx-worker", description="Fractonica Hub embedding worker (EmbeddingGemma 2)")
    ap.add_argument("--version", action="version", version=f"fx-worker {__version__}")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd")

    run = sub.add_parser("run", help="take embedding jobs from the hub (default)")
    run.add_argument("--hub", help="hub base URL (env FX_HUB)")
    run.add_argument("--token", help="worker token fxh_… (env FX_TOKEN)")
    run.add_argument("--max", type=int, default=8, dest="max_jobs", help="jobs per poll (default 8)")
    run.add_argument("--wait", type=int, default=25, help="long-poll seconds (default 25)")
    _model_args(run)

    login = sub.add_parser("login", help="redeem a pairing code and save hub + token")
    login.add_argument("--hub", required=True)
    login.add_argument("--code", required=True, help="XXXX-XXXX from the hub's web UI or `hub pair --kind worker`")
    login.add_argument("--name", default=f"fx-worker on {socket.gethostname().split('.')[0]}")

    st = sub.add_parser("selftest", help="load the model, pick the device, run sanity checks")
    _model_args(st)

    b = sub.add_parser("bench", help="measure load time, memory and latencies")
    _model_args(b)
    b.add_argument("--repeat", type=int, default=3)
    return ap


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # `run` is the default command: `fx-worker --hub … --token …`
    i = 1 if argv[:1] in (["-v"], ["--verbose"]) else 0
    if i >= len(argv) or (argv[i] not in COMMANDS and argv[i] not in ("-h", "--help", "--version")):
        argv.insert(i, "run")
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    for noisy in ("httpx", "httpx2", "httpcore", "urllib3", "filelock", "huggingface_hub", "sentence_transformers",
                  "transformers"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    if getattr(args, "model", None) and _model_cached(args.model):
        os.environ.setdefault("HF_HUB_OFFLINE", "1")  # no network round trips when the weights are here
    return {"run": cmd_run, "login": cmd_login, "selftest": cmd_selftest, "bench": cmd_bench}[args.cmd](args)


def _model_cached(model_id: str) -> bool:
    """Is the model in the Hugging Face cache? (Checked before importing huggingface_hub, whose settings
    are read at import time.)"""
    if os.path.isdir(model_id):
        return True
    hub_cache = os.environ.get("HF_HUB_CACHE") or os.path.join(
        os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface"), "hub")
    snaps = os.path.join(hub_cache, "models--" + model_id.replace("/", "--"), "snapshots")
    try:
        return any(os.path.exists(os.path.join(snaps, s, "model.safetensors")) for s in os.listdir(snaps))
    except OSError:
        return False


def _embedder(args):
    from .embedder import Embedder

    mods = [m.strip() for m in args.modalities.split(",") if m.strip()]
    bad = set(mods) - {"text", "image", "audio", "video"}
    if bad:
        raise SystemExit(f"unknown modalities: {', '.join(sorted(bad))}")
    return Embedder(args.model, mods, device=args.device, dtype=args.dtype, selfcheck=not args.no_selfcheck)


def cmd_login(args) -> int:
    from .hub import Hub, HubError

    cfg = config.load()
    hub = Hub(args.hub, None)
    try:
        res = hub.pair(args.code, args.name, f"{platform.system()} {platform.release()} ({platform.machine()})",
                       config.install_id(cfg))
    except HubError as e:
        print(f"pairing failed: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"cannot reach {args.hub}: {e}", file=sys.stderr)
        return 1
    finally:
        hub.close()
    client = res.get("client") or {}
    if "worker" not in (client.get("scopes") or []):
        print("warning: this code does not grant the `worker` scope; make one with "
              "`hub pair --kind worker --scopes worker,read`", file=sys.stderr)
    cfg.update({"hub": args.hub.rstrip("/"), "token": res["token"], "client": client.get("id"),
                "name": client.get("name"), "hubInfo": res.get("hub")})
    path = config.save(cfg)
    print(f"paired as {client.get('name')} ({client.get('id')}), scopes {','.join(client.get('scopes') or [])}")
    print(f"saved to {path}; run `fx-worker` to start")
    return 0


def cmd_run(args) -> int:
    from .hub import Hub
    from .worker import Worker

    hub_url, token = config.resolve(args.hub, args.token)
    if not hub_url or not token:
        print("no hub/token: pass --hub and --token, set FX_HUB and FX_TOKEN, or run "
              "`fx-worker login --hub URL --code XXXX-XXXX`", file=sys.stderr)
        return 2
    emb = _embedder(args).load()
    hub = Hub(hub_url, token)
    worker = Worker(hub, emb, wait=args.wait, max_jobs=args.max_jobs, heartbeat_hub=Hub(hub_url, token))

    def _stop(signum, frame):
        logging.getLogger("fx_worker").info("signal %s: stopping", signum)
        worker.stop.set()
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _stop)
    try:
        worker.run()
    except KeyboardInterrupt:
        worker.stop.set()
    finally:
        hub.close()
    logging.getLogger("fx_worker").info("stopped: %s", worker.stats)
    return 0


def cmd_selftest(args) -> int:
    import numpy as np

    emb = _embedder(args).load()
    print(f"device {emb.device}, dtype {emb.dtype}, modalities {','.join(emb.modalities)}, "
          f"load {emb.load_seconds:.1f} s")
    if emb.selfcheck_cos:
        print("agreement with CPU fp32 (cosine):", {k: round(v, 5) for k, v in emb.selfcheck_cos.items()})
    q = emb.encode_queries(["the night the moon was huge"])
    d = emb.encode_queries(["title: 🌙 Night walk | text: The moon rose over the river, orange and enormous.",
                            "title: Groceries | text: milk, eggs, bread, butter, two lemons"], task="document")
    s = (q @ d.T)[0]
    print(f"moon query vs moon entry {s[0]:.3f}, vs grocery list {s[1]:.3f}")
    ok = bool(s[0] > s[1]) and bool(np.isfinite(s).all())
    print("ok" if ok else "FAILED")
    return 0 if ok else 1


def cmd_bench(args) -> int:
    from .bench import run_bench

    return run_bench(_embedder(args), repeat=args.repeat)


if __name__ == "__main__":
    sys.exit(main())

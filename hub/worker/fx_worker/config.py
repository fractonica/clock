"""Where the worker finds its hub and token: flags, then environment, then the config file."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path


def config_path() -> Path:
    if p := os.environ.get("FX_WORKER_CONFIG"):
        return Path(p).expanduser()
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return Path(base) / "fractonica-hub" / "worker.json"


def load() -> dict:
    p = config_path()
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        raise SystemExit(f"cannot read {p}: {e}")


def save(cfg: dict) -> Path:
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # holds a token: owner only
    with os.fdopen(fd, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    os.replace(tmp, p)
    return p


def install_id(cfg: dict) -> str:
    """Stable id of this worker install, so pairing again replaces the client instead of adding one."""
    if not cfg.get("device"):
        cfg["device"] = str(uuid.uuid4())
    return cfg["device"]


def resolve(hub: str | None, token: str | None) -> tuple[str | None, str | None]:
    cfg = load()
    hub = hub or os.environ.get("FX_HUB") or cfg.get("hub")
    token = token or os.environ.get("FX_TOKEN")
    if not token and cfg.get("token") and (cfg.get("hub") or "").rstrip("/") == (hub or "").rstrip("/"):
        token = cfg["token"]  # the saved token belongs to the saved hub only
    return hub, token

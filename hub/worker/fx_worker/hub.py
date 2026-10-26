"""HTTP client for the worker endpoints of the Fractonica Hub API (hub/API.md, "Worker protocol")."""

from __future__ import annotations

import logging
import random
import shutil
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from . import __version__

log = logging.getLogger("fx_worker.hub")

USER_AGENT = f"fx-worker/{__version__}"


class HubError(Exception):
    """A non-2xx answer. `status` is the HTTP status, `code` the API error code."""

    def __init__(self, status: int, code: str = "", message: str = "", retry_after: float | None = None):
        super().__init__(f"{status} {code}: {message}".strip())
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after

    @property
    def transient(self) -> bool:
        return self.status in (408, 425, 429) or self.status >= 500


class Unauthorized(HubError):
    pass


# Errors where waiting and trying again is the right answer.
NETWORK_ERRORS = (httpx.TransportError,)


def _error(resp: httpx.Response) -> HubError:
    code, message = "", resp.reason_phrase
    try:
        err = resp.json().get("error", {})
        code, message = err.get("code", ""), err.get("message", message)
    except Exception:
        pass
    ra = resp.headers.get("Retry-After")
    try:
        retry_after = float(ra) if ra is not None else None
    except ValueError:
        retry_after = None
    cls = Unauthorized if resp.status_code == 401 else HubError
    return cls(resp.status_code, code, message, retry_after)


class Backoff:
    """Exponential backoff with full jitter: 1, 2, 4 … 60 s."""

    def __init__(self, base: float = 1.0, cap: float = 60.0):
        self.base, self.cap, self.n = base, cap, 0

    def next(self) -> float:
        d = min(self.cap, self.base * 2**self.n)
        self.n = min(self.n + 1, 16)
        return d / 2 + random.uniform(0, d / 2)

    def reset(self):
        self.n = 0


class Hub:
    def __init__(self, base_url: str, token: str | None, timeout: float = 30.0):
        self.base = base_url.rstrip("/")
        self.token = token
        headers = {"User-Agent": USER_AGENT}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.http = httpx.Client(headers=headers, timeout=httpx.Timeout(timeout, connect=10.0),
                                 follow_redirects=False)

    def close(self):
        self.http.close()

    def url(self, path: str) -> str:
        """Hub-relative paths (`/v1/blobs/…`) resolve under the hub's base URL, path prefix included."""
        if path.startswith(("http://", "https://")):
            return path
        return self.base + (path if path.startswith("/") else "/" + path)

    def _same_origin(self, url: str) -> bool:
        a, b = urlsplit(url), urlsplit(self.base)
        return (a.scheme, a.netloc) == (b.scheme, b.netloc)

    def _json(self, method: str, path: str, *, json=None, params=None, timeout=None) -> dict:
        resp = self.http.request(method, self.url(path), json=json, params=params,
                                 timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT)
        if resp.status_code >= 400:
            raise _error(resp)
        if not resp.content:
            return {}
        return resp.json()

    # ---------------------------------------------------------------- endpoints

    def info(self) -> dict:
        return self._json("GET", "/v1")

    def pair(self, code: str, name: str, platform: str, device: str) -> dict:
        return self._json("POST", "/v1/pair", json={"code": code, "name": name, "kind": "worker",
                                                     "platform": platform, "device": device})

    def jobs(self, wait: int = 25, max_jobs: int = 8) -> list[dict]:
        data = self._json("GET", "/v1/worker/jobs", params={"wait": wait, "max": max_jobs}, timeout=wait + 15)
        return list(data.get("jobs") or [])

    def finish(self, job_id: str, body: dict) -> dict:
        return self._json("POST", f"/v1/worker/jobs/{job_id}", json=body, timeout=60)

    def heartbeat(self, body: dict) -> dict:
        return self._json("POST", "/v1/worker/heartbeat", json=body, timeout=15)

    def download(self, path: str, dest: Path, max_bytes: int | None = None) -> Path:
        """Stream a blob to `dest`. The token goes only to the hub's own origin."""
        url = self.url(path)
        if self._same_origin(url):
            return self._download(self.http, url, dest, max_bytes)
        with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as foreign:
            return self._download(foreign, url, dest, max_bytes)

    @staticmethod
    def _download(client: httpx.Client, url: str, dest: Path, max_bytes: int | None) -> Path:
        with client.stream("GET", url, timeout=httpx.Timeout(120.0, connect=10.0)) as resp:
            if resp.status_code >= 400:
                resp.read()
                raise _error(resp)
            n = 0
            tmp = dest.with_suffix(dest.suffix + ".part")
            with open(tmp, "wb") as f:
                for chunk in resp.iter_bytes(1 << 20):
                    n += len(chunk)
                    if max_bytes and n > max_bytes:
                        raise HubError(413, "too_large", f"blob larger than {max_bytes} bytes")
                    f.write(chunk)
            shutil.move(tmp, dest)
        return dest

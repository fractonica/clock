"""A small stand-in for the hub: exactly the endpoints a worker uses (hub/API.md, "Worker protocol").

    GET  /v1                         (no auth)
    POST /v1/pair                    (no auth) redeem a code made with `add_code`
    GET  /v1/worker/jobs?wait&max    (worker) long-poll; leases jobs; query jobs first
    POST /v1/worker/jobs/{id}        (worker) finish a leased job
    POST /v1/worker/heartbeat        (worker)
    GET  /v1/blobs/{hash}            (read)  bytes with their type, ETag, Range

Faults for tests: `fail_next(n, status, path_prefix)` answers the next n matching requests with an error.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import numpy as np

CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class MockHub:
    def __init__(self, port: int = 0, token: str = "fxh_test", scopes=("worker", "read"), lease: float = 120.0):
        self.port = port
        self.tokens: dict[str, dict] = {token: {"id": "c_worker", "scopes": list(scopes), "kind": "worker"}}
        self.token = token
        self.lease = lease
        self.lock = threading.Condition()
        self.queue: list[dict] = []
        self.leased: dict[str, tuple[dict, float]] = {}
        self.results: dict[str, dict] = {}
        self.attempts: dict[str, int] = {}
        self.heartbeats: list[dict] = []
        self.blobs: dict[str, tuple[bytes, str]] = {}
        self.blob_gets: list[tuple[str, str | None]] = []  # (hash, Authorization header)
        self.codes: dict[str, dict] = {}
        self.pairs: list[dict] = []
        self.polls = 0
        self.faults: list[dict] = []
        self.conns: set = set()
        self.server: _Server | None = None
        self.thread: threading.Thread | None = None

    # ---------------------------------------------------------------- control

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "MockHub":
        self.server = _Server(("127.0.0.1", self.port), self._handler())
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()
        return self

    def stop(self):
        """Like a process exit: stop listening and drop every open (keep-alive) connection."""
        if self.server:
            server, self.server = self.server, None
            with self.lock:
                self.lock.notify_all()
            server.shutdown()
            server.server_close()
            for conn in list(self.conns):
                try:
                    conn.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    def add_blob(self, data: bytes, mime: str) -> str:
        h = hashlib.sha256(data).hexdigest()
        self.blobs[h] = (data, mime)
        return h

    def add_code(self, scopes=("worker", "read")) -> str:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        self.codes[code] = {"scopes": list(scopes)}
        return f"{code[:4]}-{code[4:]}"

    def _enqueue(self, job: dict) -> str:
        with self.lock:
            self.queue.append(job)
            self.lock.notify_all()
        return job["id"]

    def add_query_job(self, inputs: list[str], task: str = "query") -> str:
        return self._enqueue({"id": "j_" + secrets.token_hex(6), "type": "embed.query", "inputs": inputs,
                              "task": task})

    def add_record_job(self, record: dict, text: str, media: list[dict] | None = None) -> str:
        """`media`: [{hash, type, role}] (url filled in); `record.blobs` gets the same entries if missing."""
        media = [dict(m, url=m.get("url") or f"/v1/blobs/{m['hash']}") for m in media or []]
        record = dict(record)
        record.setdefault("blobs", [{k: v for k, v in m.items() if k != "url"} for m in media])
        return self._enqueue({"id": "j_" + secrets.token_hex(6), "type": "embed.record", "record": record,
                              "text": text, "media": media})

    def fail_next(self, n: int, status: int = 503, path_prefix: str = "/v1/", retry_after: float | None = None):
        self.faults.append({"n": n, "status": status, "prefix": path_prefix, "retry_after": retry_after})

    def wait_results(self, ids, timeout: float = 60.0) -> dict[str, dict]:
        deadline = time.monotonic() + timeout
        with self.lock:
            while not all(i in self.results for i in ids):
                left = deadline - time.monotonic()
                if left <= 0:
                    missing = [i for i in ids if i not in self.results]
                    raise TimeoutError(f"no result for {missing}")
                self.lock.wait(min(left, 0.2))
            return {i: self.results[i] for i in ids}

    # ---------------------------------------------------------------- the server

    def _take(self, max_jobs: int) -> list[dict]:
        now = time.monotonic()
        for jid, (job, until) in list(self.leased.items()):
            if until < now:  # lease ran out: back to the queue
                del self.leased[jid]
                self.queue.append(job)
        self.queue.sort(key=lambda j: 0 if j["type"] == "embed.query" else 1)  # stable: queries first
        taken, self.queue = self.queue[:max_jobs], self.queue[max_jobs:]
        for j in taken:
            self.leased[j["id"]] = (j, now + self.lease)
            self.attempts[j["id"]] = self.attempts.get(j["id"], 0) + 1
        return taken

    def _handler(self):
        hub = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def setup(self):
                super().setup()
                hub.conns.add(self.connection)

            def finish(self):
                hub.conns.discard(self.connection)
                super().finish()

            def handle_one_request(self):
                if hub.server is None:  # stopped: no more requests on old keep-alive connections
                    self.close_connection = True
                    return
                super().handle_one_request()

            def log_message(self, *a):
                pass

            def _send(self, status: int, body=None, headers: dict | None = None, raw: bytes | None = None,
                      ctype: str = "application/json; charset=utf-8"):
                data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)

            def _err(self, status: int, code: str, message: str = "", headers=None):
                self._send(status, {"error": {"code": code, "message": message or code, "details": {}}}, headers)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                try:
                    return json.loads(raw) if raw else {}
                except ValueError:
                    return None

            def _auth(self, scope: str) -> dict | None:
                h = self.headers.get("Authorization") or ""
                m = re.fullmatch(r"Bearer (\S+)", h)
                client = hub.tokens.get(m.group(1)) if m else None
                if client is None:
                    self._err(401, "unauthorized")
                    return None
                if scope not in client["scopes"]:
                    self._err(403, "forbidden", f"missing scope {scope}")
                    return None
                return client

            def _fault(self) -> bool:
                for f in hub.faults:
                    if f["n"] > 0 and self.path.startswith(f["prefix"]):
                        f["n"] -= 1
                        headers = {"Retry-After": str(f["retry_after"])} if f["retry_after"] is not None else None
                        self._err(f["status"], "unavailable", "injected fault", headers)
                        return True
                return False

            def do_GET(self):
                u = urlsplit(self.path)
                q = parse_qs(u.query)
                if self._fault():
                    return
                if u.path == "/v1":
                    return self._send(200, {"hub": {"id": "h_mock", "name": "Mock Hub", "version": "0"}, "api": 1,
                                            "embedding": {"model": "google/embeddinggemma-2", "dim": 768,
                                                          "dims": [768, 512, 256, 128], "worker": True}})
                if u.path == "/v1/worker/jobs":
                    if not self._auth("worker"):
                        return
                    try:
                        wait = min(30.0, float(q.get("wait", ["0"])[0]))
                        max_jobs = max(1, min(64, int(q.get("max", ["8"])[0])))
                    except ValueError:
                        return self._err(400, "bad_request", "wait and max are numbers")
                    deadline = time.monotonic() + wait
                    with hub.lock:
                        hub.polls += 1
                        while True:
                            jobs = hub._take(max_jobs)
                            left = deadline - time.monotonic()
                            if jobs or left <= 0 or hub.server is None:
                                break
                            hub.lock.wait(min(left, 0.1))
                    return self._send(200, {"jobs": jobs})
                m = re.fullmatch(r"/v1/blobs/([0-9a-f]{64})", u.path)
                if m:
                    if not self._auth("read"):
                        return
                    hub.blob_gets.append((m.group(1), self.headers.get("Authorization")))
                    if m.group(1) not in hub.blobs:
                        return self._err(404, "not_found")
                    data, mime = hub.blobs[m.group(1)]
                    headers = {"ETag": f'"{m.group(1)}"', "Accept-Ranges": "bytes",
                               "Cache-Control": "private, max-age=31536000, immutable"}
                    rng = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range") or "")
                    if rng:
                        a = int(rng.group(1))
                        b = int(rng.group(2)) if rng.group(2) else len(data) - 1
                        headers["Content-Range"] = f"bytes {a}-{b}/{len(data)}"
                        return self._send(206, raw=data[a : b + 1], headers=headers, ctype=mime)
                    return self._send(200, raw=data, headers=headers, ctype=mime)
                self._err(404, "not_found")

            def do_POST(self):
                u = urlsplit(self.path)
                if self._fault():
                    return
                body = self._body()
                if body is None:
                    return self._err(400, "bad_request", "invalid JSON")
                if u.path == "/v1/pair":
                    code = re.sub(r"[\s-]", "", str(body.get("code", ""))).upper()
                    spec = hub.codes.pop(code, None)
                    if spec is None:
                        return self._err(404, "not_found", "unknown or used code")
                    token = "fxh_" + secrets.token_urlsafe(24)
                    client = {"id": "c_" + secrets.token_hex(4), "name": body.get("name"),
                              "kind": body.get("kind"), "scopes": spec["scopes"], "kinds": ["*"]}
                    hub.tokens[token] = client
                    hub.pairs.append(body)
                    return self._send(201, {"client": client, "token": token,
                                            "hub": {"id": "h_mock", "name": "Mock Hub", "version": "0"}})
                if u.path == "/v1/worker/heartbeat":
                    if not self._auth("worker"):
                        return
                    if not isinstance(body.get("model"), str) or not isinstance(body.get("modalities"), list):
                        return self._err(400, "bad_request", "model and modalities required")
                    with hub.lock:
                        hub.heartbeats.append(body)
                    return self._send(200, {"ok": True})
                m = re.fullmatch(r"/v1/worker/jobs/([A-Za-z0-9_.:-]+)", u.path)
                if m:
                    if not self._auth("worker"):
                        return
                    jid = m.group(1)
                    problem = _check_result(body)
                    if problem:
                        return self._err(400, "bad_request", problem)
                    with hub.lock:
                        if jid not in hub.leased:
                            return self._err(404, "not_found", "no such leased job")
                        job, _ = hub.leased.pop(jid)
                        hub.results[jid] = body
                        hub.lock.notify_all()
                    return self._send(200, {"ok": True})
                self._err(404, "not_found")

        return H


def _check_result(body: dict) -> str | None:
    """The shape API.md asks of a finished job; vectors must be 768 float32 and unit length."""
    if "error" in body:
        if not isinstance(body["error"], str) or not isinstance(body.get("retry"), bool):
            return "error must be a string and retry a bool"
        return None
    if not isinstance(body.get("model"), str):
        return "model missing"
    vecs = body.get("vectors")
    if not isinstance(vecs, list) or not vecs:
        return "vectors missing"
    for v in vecs:
        if not isinstance(v.get("part"), str):
            return "part missing"
        try:
            arr = np.frombuffer(base64.b64decode(v["vector"], validate=True), dtype="<f4")
        except Exception:
            return "vector is not base64 float32"
        if arr.shape != (768,):
            return f"vector has {arr.size} dimensions"
        if not np.isfinite(arr).all() or abs(float(np.linalg.norm(arr)) - 1) > 1e-3:
            return "vector is not L2-normalised"
    return None


if __name__ == "__main__":  # manual runs: python tests/mock_hub.py --port 8787 --token fxh_dev
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--token", default="fxh_dev")
    a = ap.parse_args()
    hub = MockHub(port=a.port, token=a.token).start()
    print(f"mock hub on {hub.url}, token {a.token}, pairing code {hub.add_code()}", flush=True)
    jobs = [hub.add_query_job(["the night the moon was huge", "train delay"]),
            hub.add_record_job({"id": "demo", "kind": "journal.entry"}, "title: 🌙 Night walk | text: Saw the moon rise")]
    try:
        for k, r in hub.wait_results(jobs, timeout=600).items():
            print(k, [(v["part"], len(base64.b64decode(v["vector"]))) for v in r.get("vectors", [])] or r, flush=True)
        while True:
            time.sleep(5)
            print(f"heartbeats: {len(hub.heartbeats)}, last: {hub.heartbeats[-1] if hub.heartbeats else None}", flush=True)
    except KeyboardInterrupt:
        hub.stop()

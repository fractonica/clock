"""The job loop: long-poll the hub, embed, report. Survives hub restarts and network trouble."""

from __future__ import annotations

import base64
import logging
import math
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from . import __version__
from .hub import NETWORK_ERRORS, Backoff, Hub, HubError, Unauthorized
from .embedder import AUDIO_MAX_S, VIDEO_FPS, VIDEO_MAX_FRAMES
from .media import Media, MediaError, load_audio, load_image, load_video_frames, modality_of, probe

log = logging.getLogger("fx_worker")

HEARTBEAT_EVERY = 30.0
LEASE_SECONDS = 120.0
QUERY_LATENCY = 10.0  # seconds of record work leased per poll (a search waits at most about this long)
MAX_BLOB_BYTES = 4 << 30


def encode_vector(v: np.ndarray) -> str:
    """Little-endian float32, base64 (API.md, "Search and vectors")."""
    return base64.b64encode(np.ascontiguousarray(v, dtype="<f4").tobytes()).decode("ascii")


def decode_vector(s: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype="<f4")


class JobError(Exception):
    def __init__(self, message: str, retry: bool):
        super().__init__(message)
        self.retry = retry


class Worker:
    def __init__(self, hub: Hub, embedder, *, wait: int = 25, max_jobs: int = 8, heartbeat_hub: Hub | None = None):
        self.hub = hub
        self.embedder = embedder
        self.wait = wait
        self.max_jobs = max_jobs
        self.stop = threading.Event()
        self.heartbeat_hub = heartbeat_hub
        self.stats = {"queries": 0, "records": 0, "errors": 0}
        self.record_seconds: float | None = None  # moving average of one record job
        self._hb_thread: threading.Thread | None = None
        self._connected: bool | None = None

    # ---------------------------------------------------------------- heartbeat

    def heartbeat_body(self) -> dict:
        info = self.embedder.info()
        return {"model": info["model"], "device": info["device"], "modalities": info["modalities"],
                "dtype": info.get("dtype"), "version": __version__}

    def _heartbeat_loop(self):
        hub = self.heartbeat_hub or self.hub
        while not self.stop.is_set():
            try:
                hub.heartbeat(self.heartbeat_body())
            except Unauthorized as e:
                log.error("heartbeat refused: %s (token revoked? pair again with `fx-worker login`)", e)
            except (HubError, *NETWORK_ERRORS) as e:
                log.debug("heartbeat failed: %s", e)
            except Exception:
                log.exception("heartbeat failed")
            self.stop.wait(HEARTBEAT_EVERY)

    def start_heartbeat(self):
        if self._hb_thread is None:
            self._hb_thread = threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True)
            self._hb_thread.start()

    # ---------------------------------------------------------------- main loop

    def _set_connected(self, ok: bool):
        if ok != self._connected:
            if ok:
                log.info("connected to %s", self.hub.base)
            elif self._connected is not None:
                log.warning("lost the hub at %s, retrying with backoff", self.hub.base)
            self._connected = ok

    def run(self):
        self.start_heartbeat()
        backoff = Backoff()
        while not self.stop.is_set():
            try:
                jobs = self.hub.jobs(wait=self.wait, max_jobs=self.poll_size())
                self._set_connected(True)
                backoff.reset()
            except Unauthorized as e:
                self._set_connected(False)
                log.error("hub refused the token: %s; pair again (`fx-worker login`), retrying in 60 s", e)
                self.stop.wait(60)
                continue
            except HubError as e:
                self._set_connected(False)
                delay = e.retry_after if e.retry_after is not None else backoff.next()
                if e.status == 403:
                    log.error("token lacks the `worker` scope: %s", e)
                    delay = max(delay, 60)
                else:
                    log.warning("job poll failed: %s; retrying in %.1f s", e, delay)
                self.stop.wait(delay)
                continue
            except NETWORK_ERRORS as e:
                self._set_connected(False)
                delay = backoff.next()
                log.info("hub unreachable (%s); retrying in %.1f s", type(e).__name__, delay)
                self.stop.wait(delay)
                continue
            if jobs:
                self.process(jobs)

    # ---------------------------------------------------------------- jobs

    def poll_size(self) -> int:
        """How many jobs to lease at once. Records are done one after another, so a big batch makes a search
        that arrives meanwhile wait, and on a slow device can outlive the 120 s lease (which counts as a
        failure on the hub). Take as many as fit in ~QUERY_LATENCY seconds of measured record time."""
        if self.record_seconds is None:
            return min(self.max_jobs, 2)
        return max(1, min(self.max_jobs, int(QUERY_LATENCY / max(self.record_seconds, 0.1))))

    def process(self, jobs: list[dict]):
        queries = [j for j in jobs if j.get("type") == "embed.query"]
        records = [j for j in jobs if j.get("type") == "embed.record"]
        other = [j for j in jobs if j.get("type") not in ("embed.query", "embed.record")]
        for j in other:
            self.report(j, {"error": f"unknown job type {j.get('type')!r}", "retry": False})
        self.process_queries(queries)
        for j in records:
            if self.stop.is_set():
                return  # leases run out and the hub hands the jobs to the next worker
            self.process_record(j)

    def process_queries(self, jobs: list[dict]):
        """All query jobs of one poll in one batch per task (the first thing a search waits for)."""
        by_task: dict[str, list[dict]] = {}
        for j in jobs:
            task = j.get("task") or "query"
            if task not in ("query", "document"):
                self.report(j, {"error": f"unknown task {task!r}", "retry": False})
                continue
            inputs = j.get("inputs")
            if not isinstance(inputs, list) or not inputs or not all(isinstance(s, str) for s in inputs):
                self.report(j, {"error": "inputs must be a non-empty list of strings", "retry": False})
                continue
            by_task.setdefault(task, []).append(j)
        for task, group in by_task.items():
            texts = [s for j in group for s in j["inputs"]]
            t0 = time.perf_counter()
            try:
                vecs = self.embedder.encode_queries(texts, task=task)
            except Exception as e:
                log.exception("query batch failed")
                for j in group:
                    self.report(j, {"error": f"embedding failed: {e}", "retry": True})
                continue
            log.info("embedded %d %s input(s) from %d job(s) in %.0f ms", len(texts), task, len(group),
                     (time.perf_counter() - t0) * 1000)
            k = 0
            for j in group:
                n = len(j["inputs"])
                body = {"model": self.embedder.info()["model"],
                        "vectors": [{"part": str(i), "vector": encode_vector(vecs[k + i])} for i in range(n)]}
                k += n
                self.stats["queries"] += 1
                self.report(j, body)

    def process_record(self, job: dict):
        t0 = time.perf_counter()
        rid = (job.get("record") or {}).get("id", "?")
        try:
            with tempfile.TemporaryDirectory(prefix="fx-worker-") as tmp:
                media, notes = self.fetch_media(job, Path(tmp))
                text = job.get("text") or ""
                if not text.strip() and not media:
                    raise JobError("nothing to embed: no text and no decodable media", retry=False)
                parts, plan_notes = self.embedder.encode_record(text, media)
                notes += plan_notes
        except JobError as e:
            self.stats["errors"] += 1
            log.warning("record %s: %s (retry=%s)", rid, e, e.retry)
            self.report(job, {"error": str(e), "retry": e.retry})
            return
        except Exception as e:
            self.stats["errors"] += 1
            log.exception("record %s failed", rid)
            self.report(job, {"error": f"{type(e).__name__}: {e}", "retry": True})
            return
        finally:
            self._release_accelerator_memory()
            dt = time.perf_counter() - t0
            self.record_seconds = dt if self.record_seconds is None else 0.7 * self.record_seconds + 0.3 * dt
        body = {"model": self.embedder.info()["model"],
                "vectors": [{"part": p, "vector": encode_vector(v)} for p, v in parts]}
        self.stats["records"] += 1
        log.info("record %s: %d vector(s) in %.1f s%s", rid, len(parts), dt, f" ({'; '.join(notes)})" if notes else "")
        self.report(job, body)

    def _release_accelerator_memory(self):
        if getattr(self.embedder, "device", None) == "mps":
            try:
                import torch

                torch.mps.empty_cache()
            except Exception:
                pass

    def fetch_media(self, job: dict, tmp: Path) -> tuple[list[Media], list[str]]:
        """Download and decode the job's media. Undecodable files are left out (and noted); network
        trouble fails the job with retry so it comes back."""
        notes: list[str] = []
        loaded = set(self.embedder.modalities)
        record = job.get("record") or {}
        blobs = {b.get("hash"): b for b in record.get("blobs") or [] if isinstance(b, dict)}
        poster_of = {b.get("poster"): h for h, b in blobs.items() if b.get("poster")}  # poster hash -> video
        items = [m for m in job.get("media") or [] if isinstance(m, dict) and m.get("hash")]

        decoded: dict[str, Media] = {}
        failures: list[str] = []
        for item in items:
            h, mime, role = item["hash"], item.get("type") or "", item.get("role") or ""
            modality = modality_of(mime, role)
            if modality is None:
                notes.append(f"{h[:8]}: {mime or role} is not image, audio or video")
                continue
            if modality not in loaded:
                notes.append(f"{h[:8]}: {modality} encoder not loaded")
                continue
            if h in decoded:
                continue
            path = tmp / h
            try:
                self.hub.download(item.get("url") or f"/v1/blobs/{h}", path, MAX_BLOB_BYTES)
            except HubError as e:
                if e.status in (404, 410, 413):
                    failures.append(f"{h[:8]}: {e}")
                    continue
                raise JobError(f"blob {h[:8]}: {e}", retry=True) from e
            except NETWORK_ERRORS as e:
                raise JobError(f"blob {h[:8]}: {type(e).__name__}: {e}", retry=True) from e
            try:
                decoded[h] = self.decode(path, h, modality, mime, role, blobs.get(h, {}))
            except MediaError as e:
                failures.append(f"{h[:8]}: {e}")
            finally:
                path.unlink(missing_ok=True)

        # Record order. A poster is a still of its video: when the video was embedded natively the poster
        # adds nothing; when it was not (undecodable, or no video encoder) the poster stands in for it, in
        # the video's place and as its `blob:<video hash>` part.
        video_ok = {h for h, m in decoded.items() if m.modality == "video" or blobs.get(h, {}).get("role") == "video"}
        out: list[Media] = []
        placed: set[str] = set()
        for item in items:
            h = item["hash"]
            m = decoded.get(h)
            if (item.get("role") or "") == "poster":
                vh = poster_of.get(h)
                if m is None or (vh and vh in video_ok) or h in placed:
                    continue
                if vh:
                    m.hash, m.role = vh, "video"
                    notes.append(f"{vh[:8]}: poster stands in for the video")
                    if vh in placed:
                        continue
                placed.add(m.hash)
                out.append(m)
            elif m is not None and h not in placed:
                placed.add(h)
                out.append(m)
            elif m is None and h in poster_of.values():
                # the video failed: if its poster comes later in `media`, put it here instead
                ph = next((p for p, v in poster_of.items() if v == h), None)
                pm = decoded.get(ph)
                if pm is not None and h not in placed:
                    pm.hash, pm.role = h, "video"
                    notes.append(f"{h[:8]}: poster stands in for the video")
                    placed.add(h)
                    placed.add(ph)
                    out.append(pm)

        if failures:
            notes.append("left out: " + "; ".join(failures))
            if not out and not (job.get("text") or "").strip():
                raise JobError("no decodable media and no text: " + "; ".join(failures), retry=False)
        return out, notes

    def decode(self, path: Path, h: str, modality: str, mime: str, role: str, blob: dict) -> Media:
        if modality == "image":
            return Media(h, "image", mime, role, image=load_image(path))
        info = probe(path)
        dur = info["duration"] or blob.get("duration")
        if modality == "audio":
            return Media(h, "audio", mime, role, audio=load_audio(path, AUDIO_MAX_S), duration=dur)
        if not info["video"] and info["audio"] and "audio" in self.embedder.modalities:
            # a "video" that is only sound (e.g. a voice memo in .mov): embed it as audio
            return Media(h, "audio", mime, role, audio=load_audio(path, AUDIO_MAX_S), duration=dur)
        count = VIDEO_MAX_FRAMES if not dur else max(1, min(VIDEO_MAX_FRAMES, math.ceil(dur * VIDEO_FPS)))
        frames = load_video_frames(path, count, dur)
        return Media(h, "video", mime, role, frames=frames, duration=dur)

    # ---------------------------------------------------------------- results

    def report(self, job: dict, body: dict):
        """POST the result, retrying network trouble for as long as the lease could still hold."""
        jid = job.get("id")
        deadline = time.monotonic() + LEASE_SECONDS
        backoff = Backoff(0.5, 10)
        while True:
            try:
                self.hub.finish(jid, body)
                return True
            except Unauthorized as e:
                log.error("result for %s refused: %s", jid, e)
                return False
            except HubError as e:
                if not e.transient:
                    log.warning("result for %s not taken: %s", jid, e)  # e.g. lease expired, job gone
                    return False
                err = e
            except NETWORK_ERRORS as e:
                err = e
            delay = backoff.next()
            if time.monotonic() + delay > deadline or self.stop.is_set():
                log.warning("giving up on the result for %s: %s", jid, err)
                return False
            time.sleep(delay)

"""The job loop against the mock hub, with a fake model (fast)."""

from __future__ import annotations

import contextlib
import json
import os
import stat
import threading
import time

import numpy as np
import pytest
from conftest import (apple_image, heic_bytes, jpeg_bytes, need_ffmpeg, sky_image, test_video,
                      tone_audio)
from mock_hub import MockHub

from fx_worker import cli, config
from fx_worker.hub import Hub
from fx_worker.worker import Worker, decode_vector


@contextlib.contextmanager
def running(hub: MockHub, emb, wait: int = 1, token: str | None = None):
    w = Worker(Hub(hub.url, token or hub.token), emb, wait=wait, max_jobs=8,
               heartbeat_hub=Hub(hub.url, token or hub.token))
    t = threading.Thread(target=w.run, daemon=True)
    t.start()
    try:
        yield w
    finally:
        w.stop.set()
        t.join(timeout=10)
        assert not t.is_alive(), "worker did not stop"


def vectors(result: dict) -> dict[str, np.ndarray]:
    return {v["part"]: decode_vector(v["vector"]) for v in result["vectors"]}


def test_query_jobs_are_batched_and_in_order(fake_embedder):
    with MockHub() as hub:
        a = hub.add_query_job(["the moon", "train delay"])
        b = hub.add_query_job(["a red apple"])
        c = hub.add_query_job(["title: Groceries | text: milk"], task="document")
        with running(hub, fake_embedder):
            res = hub.wait_results([a, b, c], timeout=20)
    assert [v["part"] for v in res[a]["vectors"]] == ["0", "1"]
    assert res[a]["model"] == "google/embeddinggemma-2"
    va, vb = vectors(res[a]), vectors(res[b])
    assert np.allclose(va["0"], fake_embedder.vec("querythe moon"))
    assert np.allclose(va["1"], fake_embedder.vec("querytrain delay"))
    assert np.allclose(vb["0"], fake_embedder.vec("querya red apple"))
    for v in [*va.values(), *vb.values()]:
        assert v.dtype == np.dtype("<f4") and v.shape == (768,) and abs(np.linalg.norm(v) - 1) < 1e-5
    # one model call per task for the whole poll
    assert sorted(t for _, t in fake_embedder.query_calls) == ["document", "query"]
    assert [len(x) for x, t in fake_embedder.query_calls if t == "query"] == [3]


def test_queries_come_before_records(fake_embedder):
    with MockHub() as hub:
        r = hub.add_record_job({"id": "r1", "kind": "note.x"}, "title: none | text: hello")
        q = hub.add_query_job(["hello"])
        order = []
        orig_q, orig_r = fake_embedder.encode_queries, fake_embedder.encode_record
        fake_embedder.encode_queries = lambda *a, **k: (order.append("q"), orig_q(*a, **k))[1]
        fake_embedder.encode_record = lambda *a, **k: (order.append("r"), orig_r(*a, **k))[1]
        with running(hub, fake_embedder):
            hub.wait_results([r, q])
    assert order == ["q", "r"]


def test_record_with_photos_audio_video_and_poster(fake_embedder, tmp_path):
    need_ffmpeg()
    with MockHub() as hub:
        jpg = hub.add_blob(jpeg_bytes(apple_image()), "image/jpeg")
        heic = hub.add_blob(heic_bytes(sky_image()), "image/heic")
        aud = hub.add_blob(tone_audio(tmp_path / "a.m4a").read_bytes(), "audio/mp4")
        vid = hub.add_blob(test_video(tmp_path / "v.mp4").read_bytes(), "video/mp4")
        poster = hub.add_blob(jpeg_bytes(sky_image(200)), "image/jpeg")
        media = [{"hash": jpg, "type": "image/jpeg", "role": "photo"},
                 {"hash": heic, "type": "image/heic", "role": "photo"},
                 {"hash": aud, "type": "audio/mp4", "role": "audio"},
                 {"hash": vid, "type": "video/mp4", "role": "video"},
                 {"hash": poster, "type": "image/jpeg", "role": "poster"}]
        record = {"id": "e1", "kind": "journal.entry",
                  "blobs": [*media[:3], dict(media[3], poster=poster, duration=4.0), media[4]]}
        j = hub.add_record_job(record, "title: 🌙 Night walk | text: Saw the moon rise", media)
        with running(hub, fake_embedder):
            res = hub.wait_results([j], timeout=60)[j]
        assert {h for h, _ in hub.blob_gets} == {jpg, heic, aud, vid, poster}
        assert all(auth == f"Bearer {hub.token}" for _, auth in hub.blob_gets)
    parts = [v["part"] for v in res["vectors"]]
    assert parts == ["record", f"blob:{jpg}", f"blob:{heic}", f"blob:{aud}", f"blob:{vid}"]  # no poster part
    text, ms = fake_embedder.record_calls[0]
    assert text.startswith("title: 🌙 Night walk")
    assert [m.modality for m in ms] == ["image", "image", "audio", "video"]  # poster dropped: video decoded
    assert ms[1].image.size == (480, 480)  # HEIC decoded
    assert ms[2].audio.dtype == np.float32 and 2.5 < len(ms[2].audio) / 16000 < 3.5
    assert ms[3].frames.ndim == 4 and 3 <= len(ms[3].frames) <= 5  # ~1 frame per second


def test_poster_stands_in_for_an_undecodable_video(fake_embedder):
    with MockHub() as hub:
        vid = hub.add_blob(b"\x00\x00\x00\x18ftypmp42 this is not a video", "video/quicktime")
        poster = hub.add_blob(jpeg_bytes(sky_image(200)), "image/jpeg")
        media = [{"hash": vid, "type": "video/quicktime", "role": "video"},
                 {"hash": poster, "type": "image/jpeg", "role": "poster"}]
        record = {"id": "e2", "kind": "journal.entry", "blobs": [dict(media[0], poster=poster), media[1]]}
        j = hub.add_record_job(record, "", media)
        with running(hub, fake_embedder):
            res = hub.wait_results([j], timeout=30)[j]
    assert [v["part"] for v in res["vectors"]] == ["record", f"blob:{vid}"]
    _, ms = fake_embedder.record_calls[0]
    assert [(m.modality, m.hash) for m in ms] == [("image", vid)]


def test_undecodable_media_is_not_retried(fake_embedder):
    with MockHub() as hub:
        bad = hub.add_blob(b"definitely not a HEIC file", "image/heic")
        m = [{"hash": bad, "type": "image/heic", "role": "photo"}]
        only_bad = hub.add_record_job({"id": "e3", "kind": "journal.entry"}, "", m)
        with_text = hub.add_record_job({"id": "e4", "kind": "journal.entry"}, "title: none | text: hi", m)
        with running(hub, fake_embedder):
            res = hub.wait_results([only_bad, with_text], timeout=30)
    assert res[only_bad]["retry"] is False and "decod" in res[only_bad]["error"]
    assert [v["part"] for v in res[with_text]["vectors"]] == ["record"]  # the text still gets its vector


def test_model_failure_is_retried(fake_embedder):
    fake_embedder.fail_records = True
    with MockHub() as hub:
        j = hub.add_record_job({"id": "e5", "kind": "journal.entry"}, "title: none | text: hi")
        with running(hub, fake_embedder):
            res = hub.wait_results([j], timeout=20)[j]
    assert res["retry"] is True and "boom" in res["error"]


def test_bad_jobs_are_rejected_without_retry(fake_embedder):
    with MockHub() as hub:
        a = hub.add_query_job([], task="query")
        b = hub.add_query_job(["x"], task="poetry")
        c = hub._enqueue({"id": "j_weird", "type": "embed.mystery"})
        with running(hub, fake_embedder):
            res = hub.wait_results([a, b, c], timeout=20)
    assert all(r["retry"] is False for r in res.values())


def test_heartbeat_reports_model_device_modalities(fake_embedder):
    with MockHub() as hub:
        with running(hub, fake_embedder):
            deadline = time.monotonic() + 10
            while not hub.heartbeats and time.monotonic() < deadline:
                time.sleep(0.05)
    hb = hub.heartbeats[0]
    assert hb["model"] == "google/embeddinggemma-2" and hb["device"] == "cpu"
    assert hb["modalities"] == ["text", "image", "audio", "video"]


def test_survives_errors_and_a_hub_restart(fake_embedder):
    hub = MockHub().start()
    port = hub.port
    hub.fail_next(2, 503, "/v1/worker/jobs", retry_after=0.2)
    j1 = hub.add_query_job(["before the restart"])
    with running(hub, fake_embedder) as w:
        hub.wait_results([j1], timeout=20)
        hub.stop()  # hub goes away mid long-poll
        time.sleep(1.5)  # worker sees connection refused and backs off
        hub2 = MockHub(port=port).start()
        try:
            hub2.fail_next(1, 500, "/v1/worker/jobs/")  # the first result POST fails: it is retried
            j2 = hub2.add_query_job(["after the restart"])
            res = hub2.wait_results([j2], timeout=30)
        finally:
            hub2.stop()
    assert vectors(res[j2])["0"].shape == (768,)
    assert w.stats["queries"] == 2


def test_wrong_token_does_not_crash(fake_embedder):
    with MockHub() as hub:
        with running(hub, fake_embedder, token="fxh_wrong") as w:
            time.sleep(0.5)
            assert hub.polls == 0  # refused before reaching the job queue
        assert w._connected is False


def test_login_redeems_a_code_and_saves_the_token(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FX_WORKER_CONFIG", str(tmp_path / "worker.json"))
    monkeypatch.delenv("FX_HUB", raising=False)
    monkeypatch.delenv("FX_TOKEN", raising=False)
    with MockHub() as hub:
        code = hub.add_code(("worker", "read")).lower()
        assert cli.main(["login", "--hub", hub.url + "/", "--code", code, "--name", "test worker"]) == 0
        cfg = json.loads((tmp_path / "worker.json").read_text())
        assert cfg["hub"] == hub.url and cfg["token"].startswith("fxh_") and cfg["token"] in hub.tokens
        assert stat.S_IMODE(os.stat(tmp_path / "worker.json").st_mode) == 0o600
        assert hub.pairs[0]["kind"] == "worker" and hub.pairs[0]["device"] == cfg["device"]
        assert config.resolve(None, None) == (hub.url, cfg["token"])
        assert config.resolve("http://elsewhere:8787", None) == ("http://elsewhere:8787", None)
        # pairing again reuses the install id so the hub replaces the client
        code2 = hub.add_code()
        assert cli.main(["login", "--hub", hub.url, "--code", code2]) == 0
        assert hub.pairs[1]["device"] == hub.pairs[0]["device"]
        assert cli.main(["login", "--hub", hub.url, "--code", "ZZZZ-ZZZZ"]) == 1
    monkeypatch.setenv("FX_TOKEN", "fxh_env")
    assert config.resolve(None, None)[1] == "fxh_env"
    assert config.resolve(None, "fxh_flag")[1] == "fxh_flag"


def test_blob_urls_keep_the_hub_path_prefix():
    h = Hub("http://box:8787/hub/", "fxh_x")
    assert h.url("/v1/blobs/abc") == "http://box:8787/hub/v1/blobs/abc"
    assert h._same_origin("http://box:8787/other") and not h._same_origin("http://evil:8787/v1")
    h.close()

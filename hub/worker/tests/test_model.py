"""The real model: do the embeddings make sense, does the budget hold, does the whole path work."""

from __future__ import annotations

import threading

import numpy as np
import pytest
from conftest import (apple_image, heic_bytes, need_ffmpeg, need_say, say_audio, sky_image, test_video)
from mock_hub import MockHub

from fx_worker.embedder import TOKEN_BUDGET, truncate
from fx_worker.hub import Hub
from fx_worker.media import AUDIO_RATE, Media, load_audio, load_video_frames, probe
from fx_worker.worker import Worker, decode_vector

pytestmark = pytest.mark.model

MOON = "title: 🌙 Night walk | text: Walked along the river after midnight. The full moon rose over the water, " \
       "huge and orange, and lit up the whole bank."
GROCERIES = "title: Groceries | text: milk, eggs, bread, butter, two lemons, rice, washing-up liquid"


def rank(q: np.ndarray, docs: np.ndarray) -> list[int]:
    return list(np.argsort(-(docs @ q)))


@pytest.fixture(scope="module")
def speech(media_dir):
    need_ffmpeg()
    need_say()
    train = load_audio(say_audio("the train was late again", media_dir / "train.m4a"))
    other = load_audio(say_audio("I baked a chocolate cake for my sister's birthday", media_dir / "cake.m4a"))
    return train, other


def test_device_choice_passed_the_self_check(embedder):
    assert embedder.device in ("mps", "cpu", "cuda") and embedder.dtype in ("bf16", "fp32")
    if embedder.device != "cpu" or embedder.dtype != "fp32":
        assert embedder.selfcheck_cos and min(embedder.selfcheck_cos.values()) > 0.99


def test_moon_query_finds_the_moon_entry(embedder):
    q = embedder.encode_queries(["the night the moon was huge"])[0]
    docs = embedder.encode_queries([MOON, GROCERIES], task="document")
    assert q.shape == (768,) and abs(np.linalg.norm(q) - 1) < 1e-5
    s = docs @ q
    assert s[0] > s[1] + 0.05, s


def test_red_apple_query_finds_the_apple_picture(embedder):
    q = embedder.encode_queries(["a red apple"])[0]
    imgs = embedder._encode([{"image": apple_image()}, {"image": sky_image()}])
    s = imgs @ q
    assert s[0] > s[1], s
    q2 = embedder.encode_queries(["clear blue sky with clouds"])[0]
    assert (imgs @ q2)[1] > (imgs @ q2)[0]


def test_spoken_train_delay_is_found_by_text(embedder, speech):
    train, other = speech
    q = embedder.encode_queries(["train delay"])[0]
    clips = embedder._encode([{"audio": {"array": a, "sampling_rate": AUDIO_RATE}} for a in (train, other)])
    s = clips @ q
    assert s[0] > s[1], s


def test_matryoshka_256_keeps_the_ranking(embedder, speech):
    train, other = speech
    queries = embedder.encode_queries(["the night the moon was huge", "a red apple", "train delay"])
    corpus = np.concatenate([
        embedder.encode_queries([MOON, GROCERIES], task="document"),
        embedder._encode([{"image": apple_image()}, {"image": sky_image()}]),
        embedder._encode([{"audio": {"array": a, "sampling_rate": AUDIO_RATE}} for a in (train, other)]),
    ])
    expected = [0, 2, 4]  # moon entry, apple picture, train clip
    for dim in (768, 512, 256):
        q, c = truncate(queries, dim), truncate(corpus, dim)
        assert np.allclose(np.linalg.norm(c, axis=1), 1, atol=1e-5)
        for i, want in enumerate(expected):
            pair = [want, want + 1]  # each target against its own distractor
            s = c[pair] @ q[i]
            assert s[0] > s[1], (dim, i, s)
    # and the 256-d scores track the full ones
    full, small = corpus @ queries.T, truncate(corpus, 256) @ truncate(queries, 256).T
    assert np.corrcoef(full.ravel(), small.ravel())[0, 1] > 0.9


def test_an_oversized_record_is_trimmed_to_the_context(embedder, media_dir):
    need_ffmpeg()
    rng = np.random.default_rng(1)
    long_audio = (0.1 * rng.standard_normal(AUDIO_RATE * 400)).astype(np.float32)  # 400 s: alone it overflows
    vid = test_video(media_dir / "v40.mp4", seconds=40)
    dur = probe(vid)["duration"]
    frames = load_video_frames(vid, 32, dur)
    photos = [Media(f"{i:064x}", "image", image=apple_image(256)) for i in range(12)]
    media = photos + [Media("a" * 64, "audio", audio=long_audio), Media("b" * 64, "video", frames=frames, duration=dur)]
    text = "title: A long day | text: " + "We walked and walked and talked about everything. " * 60
    inp, notes, n = embedder.record_input(text, media)
    assert n <= TOKEN_BUDGET
    assert any("trimmed" in x for x in notes)
    assert len(inp["image"]) == 12  # photos kept whole, audio and video gave way
    assert len(inp["audio"]["array"]) < len(long_audio)
    parts, _ = embedder.encode_record(text, media)
    assert [p for p, _ in parts][:2] == ["record", f"blob:{'0' * 64}"] and len(parts) == 15
    assert all(np.isfinite(v).all() and abs(np.linalg.norm(v) - 1) < 1e-4 for _, v in parts)


def test_end_to_end_through_the_mock_hub(embedder, media_dir, speech):
    """A journal entry with a HEIC photo, a voice note and a video, plus a query, through the real loop."""
    need_ffmpeg()
    with MockHub() as hub:
        photo = hub.add_blob(heic_bytes(apple_image()), "image/heic")
        sky = hub.add_blob(heic_bytes(sky_image()), "image/heic")
        voice = hub.add_blob(say_audio("the train was late again", media_dir / "voice.m4a").read_bytes(), "audio/mp4")
        video = hub.add_blob(test_video(media_dir / "clip.mp4", seconds=5).read_bytes(), "video/mp4")
        media = [{"hash": photo, "type": "image/heic", "role": "photo"},
                 {"hash": voice, "type": "audio/mp4", "role": "audio"},
                 {"hash": video, "type": "video/mp4", "role": "video"}]
        entry = hub.add_record_job({"id": "e1", "kind": "journal.entry"},
                                   "title: 🍎 Orchard | text: Picked apples, then the train home was late.", media)
        sky_entry = hub.add_record_job({"id": "e2", "kind": "journal.entry"}, "",
                                       [{"hash": sky, "type": "image/heic", "role": "photo"}])
        query = hub.add_query_job(["a red apple", "the night the moon was huge"])
        w = Worker(Hub(hub.url, hub.token), embedder, wait=1, heartbeat_hub=Hub(hub.url, hub.token))
        t = threading.Thread(target=w.run, daemon=True)
        t.start()
        try:
            res = hub.wait_results([entry, sky_entry, query], timeout=300)
        finally:
            w.stop.set()
            t.join(30)
        assert hub.heartbeats and hub.heartbeats[0]["device"] == embedder.device
    vec = {k: {v["part"]: decode_vector(v["vector"]) for v in r["vectors"]} for k, r in res.items()}
    assert list(vec[entry]) == ["record", f"blob:{photo}", f"blob:{voice}", f"blob:{video}"]
    q_apple = vec[query]["0"]
    assert q_apple @ vec[entry][f"blob:{photo}"] > q_apple @ vec[sky_entry][f"blob:{sky}"]
    assert q_apple @ vec[entry]["record"] > q_apple @ vec[sky_entry]["record"]
    # the voice note's own part is what the model makes of the decoded file
    direct = embedder._encode([{"audio": {"array": load_audio(media_dir / "voice.m4a"), "sampling_rate": AUDIO_RATE}}])
    assert float(direct[0] @ vec[entry][f"blob:{voice}"]) > 0.999

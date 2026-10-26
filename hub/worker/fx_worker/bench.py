"""`fx-worker bench`: what the worker costs on this machine. Media are generated (PIL, ffmpeg, `say`)."""

from __future__ import annotations

import os
import resource
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from .media import Media, load_audio, load_image, load_video_frames, probe


def _rss_mb() -> float:
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True)
        return int(out.stdout.strip()) / 1024
    except Exception:
        return float("nan")


def _peak_mb() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1 << 20) if os.uname().sysname == "Darwin" else r / 1024


def _accel_mb(device: str) -> float | None:
    try:
        import torch

        if device == "mps":
            return torch.mps.driver_allocated_memory() / (1 << 20)
        if device == "cuda":
            return torch.cuda.max_memory_allocated() / (1 << 20)
    except Exception:
        pass
    return None


def make_media(d: Path) -> dict[str, Path]:
    from PIL import Image, ImageDraw

    rng = np.random.default_rng(0)
    # a 12 MP "photo" with structure and noise, as JPEG and HEIC
    im = Image.new("RGB", (4032, 3024), (90, 140, 200))
    dr = ImageDraw.Draw(im)
    for _ in range(60):
        x, y = rng.integers(0, 4032), rng.integers(0, 3024)
        r = int(rng.integers(50, 600))
        dr.ellipse((x - r, y - r, x + r, y + r), fill=tuple(int(c) for c in rng.integers(0, 255, 3)))
    noise = rng.integers(0, 24, (3024, 4032, 3), dtype=np.uint8)
    im = Image.fromarray(np.clip(np.asarray(im, dtype=np.int16) + noise - 12, 0, 255).astype(np.uint8))
    out = {"jpeg": d / "photo.jpg"}
    im.save(out["jpeg"], quality=90)
    try:
        import pillow_heif  # noqa: F401

        im.save(d / "photo.heic", quality=80)
        out["heic"] = d / "photo.heic"
    except Exception:
        pass
    # 60 s of speech (macOS `say`), else a tone
    ff = shutil.which("ffmpeg")
    if shutil.which("say"):
        text = ("This morning the train was late again because of a signal failure, so I stood on the platform "
                "with a coffee and watched the pigeons. ") * 6
        subprocess.run(["say", "-o", str(d / "speech.aiff"), text], check=True)
        subprocess.run([ff, "-v", "error", "-y", "-stream_loop", "-1", "-i", str(d / "speech.aiff"), "-t", "60",
                        "-c:a", "aac", str(d / "audio60.m4a")], check=True)
    else:
        subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=60", "-c:a", "aac",
                        str(d / "audio60.m4a")], check=True)
    out["audio"] = d / "audio60.m4a"
    # 10 s 1080p H.264 with sound, like a phone clip
    subprocess.run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=10",
                    "-f", "lavfi", "-i", "sine=f=330:d=10", "-c:v", "libx264", "-preset", "veryfast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(d / "video10.mp4")], check=True)
    out["video"] = d / "video10.mp4"
    return out


def _time(fn, repeat: int) -> tuple[float, object]:
    times, res = [], None
    for _ in range(repeat):
        t = time.perf_counter()
        res = fn()
        times.append(time.perf_counter() - t)
    return statistics.median(times), res


def run_bench(emb, repeat: int = 3) -> int:
    rows: list[tuple[str, str]] = []
    rss0 = _rss_mb()
    t = time.perf_counter()
    emb.load()
    rows.append(("model load (incl. self-check)", f"{time.perf_counter() - t:.1f} s"))
    rows.append(("device / dtype", f"{emb.device} / {emb.dtype}, modalities {','.join(emb.modalities)}"))

    def mem(label):
        acc = _accel_mb(emb.device)
        rows.append((f"memory {label}", f"RSS {_rss_mb():.0f} MB (peak {_peak_mb():.0f} MB, before load "
                                         f"{rss0:.0f} MB)" + (f", {emb.device} driver {acc:.0f} MB" if acc else "")))

    mem("after load")
    emb.encode_queries(["warm up"])
    s, _ = _time(lambda: emb.encode_queries(["the night the moon was huge"]), repeat * 3)
    rows.append(("text query, 1", f"{s * 1000:.0f} ms"))
    qs = [f"query number {i} about trains, moons and apples" for i in range(8)]
    s, _ = _time(lambda: emb.encode_queries(qs), repeat)
    rows.append(("text queries, batch of 8", f"{s * 1000:.0f} ms ({s * 1000 / 8:.0f} ms each)"))
    doc = "title: 🌙 Night walk | text: " + "Saw the moon rise over the river, orange and enormous. " * 20
    s, _ = _time(lambda: emb.encode_queries([doc], task="document"), repeat)
    rows.append(("journal entry text (~300 tokens)", f"{s * 1000:.0f} ms"))

    with tempfile.TemporaryDirectory(prefix="fx-bench-") as tmp:
        files = make_media(Path(tmp))
        media: list[Media] = []
        if "image" in emb.modalities:
            for kind in ("jpeg", "heic"):
                if kind not in files:
                    continue
                s_dec, im = _time(lambda: load_image(files[kind]), repeat)
                m = Media("p" * 64, "image", image=im)
                emb.encode_record("", [m])  # warm the vision path
                s, _ = _time(lambda: emb._encode([emb.blob_input(m)]), repeat)
                rows.append((f"photo 12 MP {kind.upper()}", f"decode {s_dec * 1000:.0f} ms + embed {s * 1000:.0f} ms"))
                media.append(m)
        if "audio" in emb.modalities:
            s_dec, pcm = _time(lambda: load_audio(files["audio"], 330), repeat)
            m = Media("a" * 64, "audio", audio=pcm)
            s, _ = _time(lambda: emb._encode([emb.blob_input(m)]), repeat)
            rows.append(("audio 60 s (1,500 tokens)", f"decode {s_dec * 1000:.0f} ms + embed {s * 1000:.0f} ms"))
            media.append(m)
        if "video" in emb.modalities:
            dur = probe(files["video"])["duration"]
            s_dec, fr = _time(lambda: load_video_frames(files["video"], 10, dur), repeat)
            m = Media("v" * 64, "video", frames=fr, duration=dur)
            s, _ = _time(lambda: emb._encode([emb.blob_input(m)]), repeat)
            rows.append((f"video 10 s 1080p ({len(fr)} frames)", f"decode {s_dec * 1000:.0f} ms + embed {s * 1000:.0f} ms"))
            media.append(m)
        if media:
            text = "title: 🚆 Late again | text: The train was late again, so I filmed the platform."
            inp, notes, n = emb.record_input(text, media)
            s, _ = _time(lambda: emb.encode_record(text, media), 1)
            rows.append((f"whole record: text + {len(media)} media ({n} tokens) + its blob parts",
                         f"{s:.1f} s" + (f" ({'; '.join(notes)})" if notes else "")))
        mem("after media")

    w = max(len(k) for k, _ in rows)
    for k, v in rows:
        print(f"{k:<{w}}  {v}")
    return 0

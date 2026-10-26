from __future__ import annotations

import hashlib
import io
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))

from fx_worker.embedder import DIM, l2n  # noqa: E402

FFMPEG = shutil.which("ffmpeg")
SAY = shutil.which("say")


# ---------------------------------------------------------------- generated media


def apple_image(size=480) -> Image.Image:
    """A red apple, more or less: red disc, a stem, a leaf, on a white table."""
    im = Image.new("RGB", (size, size), (245, 245, 240))
    d = ImageDraw.Draw(im)
    s = size / 480
    d.ellipse((90 * s, 120 * s, 390 * s, 420 * s), fill=(200, 20, 25))
    d.ellipse((150 * s, 170 * s, 220 * s, 230 * s), fill=(240, 110, 110))  # highlight
    d.rectangle((232 * s, 70 * s, 248 * s, 135 * s), fill=(100, 60, 20))  # stem
    d.ellipse((248 * s, 70 * s, 330 * s, 115 * s), fill=(50, 150, 40))  # leaf
    return im


def sky_image(size=480) -> Image.Image:
    """Blue sky with a couple of clouds."""
    top, bottom = np.array([60, 120, 220]), np.array([160, 200, 250])
    grad = np.linspace(0, 1, size)[:, None, None] * (bottom - top) + top
    arr = np.broadcast_to(grad, (size, size, 3)).astype(np.uint8)
    im = Image.fromarray(arr.copy())
    d = ImageDraw.Draw(im)
    for x, y, r in ((120, 140, 50), (170, 130, 60), (220, 150, 45), (340, 300, 40), (380, 290, 50)):
        d.ellipse((x - r, y - r // 2, x + r, y + r // 2), fill=(250, 250, 252))
    return im


def jpeg_bytes(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, "JPEG", quality=90)
    return b.getvalue()


def heic_bytes(im: Image.Image) -> bytes:
    import pillow_heif  # noqa: F401  (registers the HEIF writer)

    b = io.BytesIO()
    im.save(b, "HEIF", quality=85)
    return b.getvalue()


def say_audio(text: str, path: Path) -> Path:
    """Speech with macOS `say`, as AAC in .m4a like the app's voice notes."""
    aiff = path.with_suffix(".aiff")
    subprocess.run([SAY, "-o", str(aiff), text], check=True)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(aiff), "-c:a", "aac", str(path)], check=True)
    aiff.unlink()
    return path


def tone_audio(path: Path, seconds: float = 3.0, freq: int = 440) -> Path:
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f={freq}:d={seconds}",
                    "-c:a", "aac", str(path)], check=True)
    return path


def test_video(path: Path, seconds: float = 4.0, size: str = "320x240") -> Path:
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=15:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=f=330:d={seconds}", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", str(path)], check=True)
    return path


test_video.__test__ = False  # not a test


# ---------------------------------------------------------------- a fake model, for the loop tests


class FakeEmbedder:
    """Deterministic vectors from content hashes; records what it was asked."""

    def __init__(self, modalities=("text", "image", "audio", "video")):
        self.modalities = tuple(modalities)
        self.device = "cpu"
        self.query_calls: list[tuple[list[str], str]] = []
        self.record_calls: list[tuple[str, list]] = []
        self.fail_records = False

    def info(self):
        return {"model": "google/embeddinggemma-2", "device": "cpu", "dtype": "fp32",
                "modalities": list(self.modalities)}

    @staticmethod
    def vec(key: str) -> np.ndarray:
        seed = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "little")
        return l2n(np.random.default_rng(seed).standard_normal(DIM))

    def encode_queries(self, texts, task="query"):
        self.query_calls.append((list(texts), task))
        return np.stack([self.vec(task + t) for t in texts])

    def encode_record(self, text, media):
        if self.fail_records:
            raise RuntimeError("boom")
        self.record_calls.append((text, media))
        parts = [("record", self.vec(text + "".join(m.hash for m in media)))]
        seen = set()
        for m in media:
            if m.role != "poster" and m.hash not in seen:
                seen.add(m.hash)
                parts.append((f"blob:{m.hash}", self.vec(m.hash)))
        return parts, []


@pytest.fixture
def fake_embedder():
    return FakeEmbedder()


@pytest.fixture(scope="session")
def embedder():
    """The real model, loaded once for the session (device picked by the self-check)."""
    from fx_worker.embedder import Embedder

    return Embedder().load()


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("media")


def need_ffmpeg():
    if not FFMPEG:
        pytest.skip("ffmpeg not installed")


def need_say():
    if not SAY:
        pytest.skip("macOS `say` not available")

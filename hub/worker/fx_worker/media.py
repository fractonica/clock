"""Decoding of the journal's media into what the EmbeddingGemma 2 processor takes.

Images (JPEG, PNG, HEIC, …) → RGB PIL images, upright (EXIF orientation applied), at most `IMAGE_MAX_SIDE` px.
Audio (any container ffmpeg reads) → mono 16 kHz float32.
Video → RGB frames sampled uniformly over the clip with ffmpeg, at most `VIDEO_MAX_SIDE` px.

Anything that cannot be decoded raises `MediaError`; the worker reports such a job with `retry: false`
(the bytes will not get better by trying again).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF = True
except Exception:  # pragma: no cover - optional at runtime
    HEIF = False

AUDIO_RATE = 16_000
IMAGE_MAX_SIDE = 1536  # the processor downsizes to ~280 soft tokens (~800 px), this only bounds work
VIDEO_MAX_SIDE = 768  # 140 soft tokens per frame is ~570 px square
FFMPEG_TIMEOUT = 300

Image.MAX_IMAGE_PIXELS = 300_000_000  # panoramas; still refuse decompression bombs beyond that


class MediaError(Exception):
    """The file could not be decoded. Not worth retrying."""


def ffmpeg_bin() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg not found on PATH (brew install ffmpeg)")
    return path


def ffprobe_bin() -> str | None:
    return shutil.which("ffprobe")


@dataclass
class Media:
    """One media blob of a record, decoded once and shared by the record part and its own `blob:` part."""

    hash: str
    modality: str  # image | audio | video
    mime: str = ""
    role: str = ""
    image: Image.Image | None = None
    audio: np.ndarray | None = None  # mono float32 at AUDIO_RATE
    frames: np.ndarray | None = None  # (T, H, W, 3) uint8
    duration: float | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def seconds(self) -> float:
        if self.audio is not None:
            return len(self.audio) / AUDIO_RATE
        return self.duration or 0.0


def modality_of(mime: str, role: str) -> str | None:
    """Which encoder a blob goes to: by role first (the hub's word), MIME type second."""
    role = (role or "").lower()
    mime = (mime or "").lower()
    if role in ("photo", "poster", "image"):
        return "image"
    if role in ("video",):
        return "video"
    if role in ("audio", "voice"):
        return "audio"
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return None


# ---------------------------------------------------------------- images


def load_image(path: str | Path, max_side: int = IMAGE_MAX_SIDE) -> Image.Image:
    try:
        im = Image.open(path)
        if im.format == "JPEG":
            im.draft("RGB", (max_side, max_side))  # decode at a reduced scale, much faster for 12 MP photos
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P", "PA"):
            # flatten transparency on white, like a viewer would
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.getchannel("A"))
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        im.thumbnail((max_side, max_side), Image.Resampling.BICUBIC)
        im.load()
        if im.width < 1 or im.height < 1:
            raise MediaError("empty image")
        return im
    except MediaError:
        raise
    except Exception as e:  # PIL raises a zoo of exceptions for bad files
        raise MediaError(f"cannot decode image: {e}") from e


# ---------------------------------------------------------------- audio / video via ffmpeg


def probe(path: str | Path) -> dict:
    """ffprobe the file: {'duration': float|None, 'video': bool, 'audio': bool}."""
    exe = ffprobe_bin()
    info = {"duration": None, "video": False, "audio": False}
    if not exe:
        return info
    try:
        out = subprocess.run(
            [exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, timeout=60,
        )
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffprobe timed out") from e
    if out.returncode != 0:
        raise MediaError(f"cannot read media: {out.stderr.decode(errors='replace').strip()[:300]}")
    data = json.loads(out.stdout or b"{}")
    durations = []
    for s in data.get("streams", []):
        t = s.get("codec_type")
        if t == "video" and s.get("disposition", {}).get("attached_pic") != 1:
            info["video"] = True
        if t == "audio":
            info["audio"] = True
        if s.get("duration") not in (None, "N/A"):
            try:
                durations.append(float(s["duration"]))
            except ValueError:
                pass
    fmt_dur = data.get("format", {}).get("duration")
    try:
        info["duration"] = float(fmt_dur) if fmt_dur not in (None, "N/A") else (max(durations) if durations else None)
    except ValueError:
        info["duration"] = max(durations) if durations else None
    return info


def load_audio(path: str | Path, max_seconds: float | None = None) -> np.ndarray:
    """Decode the first `max_seconds` of any audio (or the audio track of a video) to mono 16 kHz float32."""
    cmd = [ffmpeg_bin(), "-nostdin", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(AUDIO_RATE)]
    if max_seconds is not None:
        cmd += ["-t", f"{max_seconds:.3f}"]
    cmd += ["-f", "f32le", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffmpeg timed out decoding audio") from e
    if out.returncode != 0:
        raise MediaError(f"cannot decode audio: {out.stderr.decode(errors='replace').strip()[:300]}")
    pcm = np.frombuffer(out.stdout, dtype="<f4").astype(np.float32, copy=True)
    if pcm.size < AUDIO_RATE // 10:  # < 0.1 s: nothing to hear
        raise MediaError("audio is empty")
    if not np.isfinite(pcm).all():
        pcm = np.nan_to_num(pcm, nan=0.0, posinf=0.0, neginf=0.0)
    return pcm


def _read_ppm_stream(data: bytes) -> list[np.ndarray]:
    """Split ffmpeg's `-f image2pipe -c:v ppm` output into frames (P6, maxval 255)."""
    frames = []
    i, n = 0, len(data)
    while i < n:
        # header: P6 <ws> width <ws> height <ws> maxval <single ws>
        tokens = []
        while len(tokens) < 4:
            while i < n and data[i : i + 1].isspace():
                i += 1
            if i < n and data[i : i + 1] == b"#":
                while i < n and data[i : i + 1] != b"\n":
                    i += 1
                continue
            j = i
            while j < n and not data[j : j + 1].isspace():
                j += 1
            if j == i:
                break
            tokens.append(data[i:j])
            i = j
        if len(tokens) < 4:
            break
        if tokens[0] != b"P6" or tokens[3] != b"255":
            raise MediaError("unexpected frame format from ffmpeg")
        w, h = int(tokens[1]), int(tokens[2])
        i += 1  # the single whitespace after maxval
        size = w * h * 3
        if i + size > n:
            break
        frames.append(np.frombuffer(data, dtype=np.uint8, count=size, offset=i).reshape(h, w, 3))
        i += size
    return frames


def load_video_frames(path: str | Path, count: int, duration: float | None,
                      max_side: int = VIDEO_MAX_SIDE) -> np.ndarray:
    """`count` frames spread evenly over the clip (ffmpeg applies the rotation of phone videos)."""
    count = max(1, int(count))
    scale = f"scale=w={max_side}:h={max_side}:force_original_aspect_ratio=decrease"
    if duration and duration > 0:
        rate = count / duration
        vf = f"fps={rate:.6f}:round=down,{scale}"
    else:
        vf = f"fps=1,{scale}"
    cmd = [ffmpeg_bin(), "-nostdin", "-v", "error", "-i", str(path), "-an", "-vf", vf,
           "-frames:v", str(count), "-f", "image2pipe", "-c:v", "ppm", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise MediaError("ffmpeg timed out decoding video") from e
    frames = _read_ppm_stream(out.stdout) if out.stdout else []
    if not frames and duration and count > 0:
        # very short clips can yield no frame from the fps filter: take the first frame
        out = subprocess.run([ffmpeg_bin(), "-nostdin", "-v", "error", "-i", str(path), "-an", "-vf", scale,
                              "-frames:v", "1", "-f", "image2pipe", "-c:v", "ppm", "-"],
                             capture_output=True, timeout=FFMPEG_TIMEOUT)
        frames = _read_ppm_stream(out.stdout) if out.stdout else []
    if not frames:
        msg = out.stderr.decode(errors="replace").strip()[:300]
        raise MediaError(f"cannot decode video{': ' + msg if msg else ''}")
    # frames of one clip share a size; guard against mid-stream resolution changes
    h, w = frames[0].shape[:2]
    frames = [f for f in frames if f.shape[:2] == (h, w)]
    return np.stack(frames)


def subsample_frames(frames: np.ndarray, count: int) -> np.ndarray:
    """Pick `count` frames evenly from already decoded ones."""
    if count >= len(frames):
        return frames
    count = max(1, count)
    idx = np.linspace(0, len(frames) - 1, count).round().astype(int)
    return frames[idx]

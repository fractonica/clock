"""EmbeddingGemma 2 behind a small interface: queries, documents, and records with interleaved media.

Device and precision are chosen by measurement, not by assumption: the candidate (MPS bf16, then MPS fp32)
embeds a fixed set of probes (text, image, audio, video) and must agree with CPU fp32 on every probe
(cosine > 0.99) and stay finite; otherwise the next candidate is tried, ending at CPU fp32. The CPU fp32
reference vectors are computed once per model file and cached in ~/.cache/fractonica-hub/.
"""

from __future__ import annotations

import gc
import hashlib
import logging
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .media import AUDIO_RATE, Media, subsample_frames

log = logging.getLogger("fx_worker.embedder")

MODEL_ID = "google/embeddinggemma-2"
DIM = 768
ALL_MODALITIES = ("text", "image", "audio", "video")

PROMPT_QUERY = "task: search result | query: "  # SearchQuery
PROMPT_DOCUMENT = "title: none | text: "  # Document

# The model's context and what each modality costs in it (model card; +2 for the begin/end markers).
TOKEN_BUDGET = 8192
BUDGET_MARGIN = 32
IMAGE_TOKENS = 280 + 2
FRAME_TOKENS = 140 + 2
AUDIO_TOKENS_PER_S = 25
AUDIO_MAX_S = (TOKEN_BUDGET - BUDGET_MARGIN - 2) / AUDIO_TOKENS_PER_S  # ~326 s: one clip alone
VIDEO_MAX_FRAMES = 32  # the video processor's default budget; 1 frame per second below it
VIDEO_FPS = 1.0
MIN_AUDIO_S = 2.0

IMAGE_TOKEN, AUDIO_TOKEN, VIDEO_TOKEN = "<|image|>", "<|audio|>", "<|video|>"

SELFCHECK_MIN_COS = 0.99


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return Path(base) / "fractonica-hub"


def l2n(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return (v / np.maximum(n, 1e-12)).astype(np.float32)


def truncate(v: np.ndarray, dim: int) -> np.ndarray:
    """Matryoshka: keep the first `dim` dimensions and re-normalise."""
    return l2n(np.asarray(v)[..., :dim])


@dataclass
class Part:
    """One vector to make: `record` or `blob:<hash>`, and the model input for it."""

    part: str
    input: object
    tokens: int = 0  # estimated sequence length


def _probe_inputs(modalities) -> dict[str, object]:
    """Deterministic probes, one or two per loaded modality."""
    from PIL import Image, ImageDraw

    probes: dict[str, object] = {
        "query": PROMPT_QUERY + "the night the moon was huge over the river",
        "doc": "title: 🌙 Night walk | text: Saw the moon rise, orange and enormous, over the river.",
    }
    if "image" in modalities:
        im = Image.new("RGB", (320, 240), (40, 90, 160))
        d = ImageDraw.Draw(im)
        d.ellipse((100, 50, 220, 170), fill=(230, 40, 30))
        d.rectangle((0, 200, 320, 240), fill=(30, 140, 50))
        probes["image"] = {"image": im}
    if "audio" in modalities:
        rng = np.random.default_rng(7)
        t = np.arange(int(AUDIO_RATE * 3)) / AUDIO_RATE
        sig = 0.3 * np.sin(2 * np.pi * (220 + 220 * t) * t) + 0.02 * rng.standard_normal(t.size)
        probes["audio"] = {"audio": {"array": sig.astype(np.float32), "sampling_rate": AUDIO_RATE}}
    if "video" in modalities:
        frames = np.zeros((3, 180, 320, 3), np.uint8)
        for k in range(3):
            frames[k, :, :, k] = 200
            frames[k, 60:120, 40 + 80 * k : 120 + 80 * k] = 255
        probes["video"] = {"video": {"array": frames, "video_metadata": None}}
    return probes


class Embedder:
    def __init__(self, model_id: str = MODEL_ID, modalities=ALL_MODALITIES, device: str = "auto",
                 dtype: str = "auto", selfcheck: bool = True):
        self.model_id = model_id
        self.modalities = tuple(m for m in ALL_MODALITIES if m in set(modalities) | {"text"})
        if "video" in self.modalities and "image" not in self.modalities:
            raise ValueError("video needs the vision encoder: add 'image' to --modalities")
        self.requested_device = device
        self.requested_dtype = dtype
        self.do_selfcheck = selfcheck
        self.model = None
        self.device = None
        self.dtype = None
        self.load_seconds = None
        self.selfcheck_cos: dict[str, float] = {}

    # ------------------------------------------------------------ loading

    def _config_kwargs(self) -> dict:
        kw = {}
        if "image" not in self.modalities:
            kw["vision_config"] = None
        if "audio" not in self.modalities:
            kw["audio_config"] = None
        return kw

    def _load(self, device: str, dtype_name: str):
        import torch
        from sentence_transformers import SentenceTransformer

        dtype = {"bf16": torch.bfloat16, "fp32": torch.float32}[dtype_name]
        kwargs = dict(
            device=device,
            model_kwargs={"dtype": dtype},
            config_kwargs=self._config_kwargs(),
        )
        try:
            model = SentenceTransformer(self.model_id, local_files_only=True, **kwargs)
        except OSError:
            log.info("model not in the local cache, downloading %s", self.model_id)
            model = SentenceTransformer(self.model_id, **kwargs)
        model.eval()
        model[0].processing_kwargs = {
            # one audio clip may use the whole context (~327 s); the extractor's default cuts at 30 s
            "audio": {"max_length": int(AUDIO_MAX_S * AUDIO_RATE) + AUDIO_RATE},
            # we pick the frames ourselves (evenly over the clip, to fit the budget)
            "video": {"do_sample_frames": False},
        }
        return model

    def _model_key(self) -> str:
        """Identifies the weights, so cached reference vectors are recomputed when the model changes."""
        try:
            from huggingface_hub import try_to_load_from_cache

            p = try_to_load_from_cache(self.model_id, "model.safetensors")
            if isinstance(p, str):
                return Path(os.path.realpath(p)).name[:16]
        except Exception:
            pass
        return hashlib.sha256(self.model_id.encode()).hexdigest()[:16]

    def _reference(self, probes: dict) -> dict[str, np.ndarray]:
        path = cache_dir() / f"selfcheck-{self._model_key()}.npz"
        ref: dict[str, np.ndarray] = {}
        if path.exists():
            try:
                with np.load(path) as z:
                    ref = {k: z[k] for k in z.files}
            except Exception:
                ref = {}
        if all(k in ref for k in probes):
            return ref
        log.info("computing CPU fp32 reference vectors for the self-check (once per model)")
        model = self._load("cpu", "fp32")
        try:
            for k, inp in probes.items():
                ref[k] = l2n(model.encode([inp], convert_to_numpy=True, show_progress_bar=False))[0]
        finally:
            del model
            gc.collect()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            np.savez(path, **ref)
        except OSError as e:
            log.warning("cannot cache reference vectors: %s", e)
        return ref

    def _check(self, model, probes, ref) -> tuple[bool, dict[str, float]]:
        cos = {}
        for k, inp in probes.items():
            v = np.asarray(model.encode([inp], convert_to_numpy=True, show_progress_bar=False), dtype=np.float32)[0]
            if not np.isfinite(v).all() or np.linalg.norm(v) < 1e-6:
                cos[k] = float("nan")
                continue
            cos[k] = float(l2n(v) @ ref[k])
        ok = all(c > SELFCHECK_MIN_COS for c in cos.values())
        return ok, cos

    def load(self):
        import torch

        t0 = time.perf_counter()
        mps = torch.backends.mps.is_available()
        dev, dt = self.requested_device, self.requested_dtype
        if dev == "auto":
            dev_list = ["mps", "cpu"] if mps else ["cpu"]
        else:
            if dev == "mps" and not mps:
                raise RuntimeError("--device mps requested but MPS is not available")
            dev_list = [dev]
        candidates = []
        for d in dev_list:
            if dt == "auto":
                # CPUs: fp32 (bf16 matmuls are slow on most CPUs); accelerators: bf16 first, fp32 second
                candidates += [(d, "fp32")] if d == "cpu" else [(d, "bf16"), (d, "fp32")]
            else:
                candidates.append((d, dt))

        probes = _probe_inputs(self.modalities)
        ref = None
        last_err = None
        for d, dtn in candidates:
            needs_check = self.do_selfcheck and not (d == "cpu" and dtn == "fp32")
            if needs_check and ref is None:
                ref = self._reference(probes)
            try:
                model = self._load(d, dtn)
            except Exception as e:  # e.g. an op missing on MPS
                last_err = e
                log.warning("cannot load on %s/%s: %s", d, dtn, e)
                continue
            if needs_check:
                try:
                    ok, cos = self._check(model, probes, ref)
                except Exception as e:
                    ok, cos = False, {"error": str(e)}
                log.info("self-check %s/%s: %s", d, dtn, {k: round(v, 5) if isinstance(v, float) else v
                                                          for k, v in cos.items()})
                if not ok:
                    log.warning("%s/%s disagrees with CPU fp32 (cosine <= %.2f), trying the next option",
                                d, dtn, SELFCHECK_MIN_COS)
                    del model
                    gc.collect()
                    if d == "mps":
                        torch.mps.empty_cache()
                    continue
                self.selfcheck_cos = cos
            self.model, self.device, self.dtype = model, d, dtn
            break
        if self.model is None:
            raise RuntimeError(f"no device/precision passed the self-check (last error: {last_err})")
        tr = self.model[0]
        self.processor = tr.processor
        self.tokenizer = getattr(self.processor, "tokenizer", self.processor)
        self.load_seconds = time.perf_counter() - t0
        log.info("model %s on %s/%s, modalities %s, ready in %.1f s", self.model_id, self.device, self.dtype,
                 ",".join(self.modalities), self.load_seconds)
        return self

    # ------------------------------------------------------------ encoding

    def _encode(self, inputs: list, batch_size: int = 8) -> np.ndarray:
        if not inputs:
            return np.zeros((0, DIM), np.float32)
        v = self.model.encode(inputs, batch_size=batch_size, convert_to_numpy=True, show_progress_bar=False)
        v = np.asarray(v, dtype=np.float32)
        if not np.isfinite(v).all():
            raise FloatingPointError("model returned non-finite values")
        return l2n(v)

    def encode_queries(self, texts: list[str], task: str = "query") -> np.ndarray:
        """`query`: SearchQuery prompt. `document`: Document prompt unless already `title: … | text: …`."""
        if task == "document":
            inputs = [t if t.lstrip().startswith("title:") else PROMPT_DOCUMENT + t for t in texts]
        else:
            inputs = [PROMPT_QUERY + t for t in texts]
        return self._encode(inputs, batch_size=32)

    def count_text_tokens(self, text: str) -> int:
        return len(self.tokenizer(text, add_special_tokens=True)["input_ids"])

    def sequence_length(self, inp) -> int:
        """Exact sequence length of one input as the processor builds it."""
        feats = self.model[0].preprocess([inp])
        return int(feats["input_ids"].shape[-1])

    def truncate_text(self, text: str, max_tokens: int) -> str:
        ids = self.tokenizer(text, add_special_tokens=False)["input_ids"]
        if len(ids) <= max_tokens:
            return text
        return self.tokenizer.decode(ids[:max_tokens], skip_special_tokens=True)

    def blob_input(self, m: Media):
        if m.modality == "image":
            return {"image": m.image}
        if m.modality == "audio":
            return {"audio": {"array": m.audio[: int(AUDIO_MAX_S * AUDIO_RATE)], "sampling_rate": AUDIO_RATE}}
        if m.modality == "video":
            return {"video": {"array": subsample_frames(m.frames, VIDEO_MAX_FRAMES), "video_metadata": None}}
        raise ValueError(m.modality)

    def plan_record(self, text: str, media: list[Media], budget: int = TOKEN_BUDGET):
        """Compose the record input: text, then one placeholder per medium in order, trimmed to the budget.

        Text and images are kept whole when they fit (photos are the journal's core); audio and video take
        what is left, scaled down together: audio keeps its first seconds, video keeps evenly spread frames.
        Returns (input, notes, estimated tokens).
        """
        notes: list[str] = []
        budget -= BUDGET_MARGIN
        text = (text or "").strip()
        images = [m for m in media if m.modality == "image"]
        timed = [m for m in media if m.modality in ("audio", "video")]

        # text never takes more than what leaves room for the media's minimum
        media_min = len(images) * IMAGE_TOKENS + sum(
            FRAME_TOKENS if m.modality == "video" else int(MIN_AUDIO_S * AUDIO_TOKENS_PER_S) + 2 for m in timed)
        text_cap = max(budget // 4, budget - media_min) if media else budget
        text_tokens = self.count_text_tokens(text) if text else 1
        if text_tokens > text_cap:
            text = self.truncate_text(text, text_cap - 1)
            text_tokens = self.count_text_tokens(text)
            notes.append(f"text trimmed to {text_cap} tokens")

        avail = budget - text_tokens
        min_timed = sum(FRAME_TOKENS if m.modality == "video" else int(MIN_AUDIO_S * AUDIO_TOKENS_PER_S) + 2
                        for m in timed)
        max_images = max(0, (avail - min_timed) // IMAGE_TOKENS)
        keep_images = set(id(m) for m in images[:max_images])
        if len(images) > max_images:
            notes.append(f"{len(images) - max_images} of {len(images)} images left out of the record vector")
        avail -= min(len(images), max_images) * IMAGE_TOKENS

        # audio seconds and video frames each want their full length; scale all down by one factor to fit
        want = {}
        for m in timed:
            if m.modality == "audio":
                want[id(m)] = min(m.seconds, AUDIO_MAX_S) * AUDIO_TOKENS_PER_S + 2
            else:
                want[id(m)] = min(len(m.frames), VIDEO_MAX_FRAMES) * FRAME_TOKENS
        total = sum(want.values())
        scale = 1.0 if total <= avail or total == 0 else max(0.0, avail / total)
        if scale < 1.0:
            notes.append(f"audio/video trimmed to {scale:.0%} to fit {TOKEN_BUDGET} tokens")

        parts: list[str] = [text] if text else []
        payload = {"image": [], "audio": [], "video": []}
        for m in media:
            if m.modality == "image":
                if id(m) in keep_images:
                    parts.append(IMAGE_TOKEN)
                    payload["image"].append(m.image)
            elif m.modality == "audio":
                secs = max(MIN_AUDIO_S, (want[id(m)] - 2) / AUDIO_TOKENS_PER_S * scale)
                parts.append(AUDIO_TOKEN)
                payload["audio"].append({"array": m.audio[: int(secs * AUDIO_RATE)], "sampling_rate": AUDIO_RATE})
            elif m.modality == "video":
                n = max(1, int(math.floor(want[id(m)] / FRAME_TOKENS * scale)))
                parts.append(VIDEO_TOKEN)
                payload["video"].append({"array": subsample_frames(m.frames, n), "video_metadata": None})

        inp: dict = {"text": " ".join(parts)}
        for k, v in payload.items():
            if v:
                inp[k] = v if len(v) > 1 else v[0]
        est = budget + BUDGET_MARGIN - avail + int(sum(want.values()) * scale)
        if not payload["image"] and not payload["audio"] and not payload["video"]:
            inp = text  # plain text: a string, so no multimodal processing at all
        return inp, notes, est

    def record_input(self, text: str, media: list[Media]):
        """`plan_record`, then verified against the real processor and shrunk until it fits the context."""
        budget = TOKEN_BUDGET
        for _ in range(6):
            inp, notes, _ = self.plan_record(text, media, budget)
            n = self.sequence_length(inp)
            if n <= TOKEN_BUDGET:
                return inp, notes, n
            budget -= (n - TOKEN_BUDGET) + 64
        raise ValueError("cannot fit the record into the model's context")

    def encode_record(self, text: str, media: list[Media]) -> tuple[list[tuple[str, np.ndarray]], list[str]]:
        """The `record` part and one `blob:<hash>` part per photo, audio and video."""
        inp, notes, _ = self.record_input(text, media)
        parts = [("record", self._encode([inp], batch_size=1)[0])]
        seen = set()
        blob_inputs, names = [], []
        for m in media:
            if m.role == "poster" or m.hash in seen:
                continue  # a poster is part of its video, not a part of its own
            seen.add(m.hash)
            blob_inputs.append(self.blob_input(m))
            names.append(f"blob:{m.hash}")
        for name, inp_b in zip(names, blob_inputs):
            parts.append((name, self._encode([inp_b], batch_size=1)[0]))
        return parts, notes

    def info(self) -> dict:
        return {"model": self.model_id, "device": self.device, "dtype": self.dtype,
                "modalities": list(self.modalities)}

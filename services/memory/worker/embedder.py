"""Speaker-embedding backends for Fase 7.

`CELTWO_MEMORY_EMBEDDER=onnx` (default) uses a 3D-Speaker CAM++ VoxCeleb model
via onnxruntime + kaldi-native-fbank. `=stub` returns a deterministic vector
derived from the waveform, so the clustering / labelling logic is testable
without downloading a model. The stub must never be used in production.
"""
from __future__ import annotations

import hashlib
import logging
import os
import urllib.request
from pathlib import Path

import numpy as np

from services.memory.storage.database import get_data_dir

EMBED_MODEL_URL = (
    "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/"
    "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx"
)
EMBED_MODEL_SHA256 = "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b"
EMBED_MODEL_NAME = "campplus_voxceleb_16k"

_embedder: "Embedder | None" = None


class Embedder:
    name: str
    dim: int

    def embed(self, pcm: np.ndarray) -> np.ndarray:  # pragma: no cover - interface
        raise NotImplementedError


def _l2(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else vec


class StubEmbedder(Embedder):
    """Deterministic, model-free embedding for tests.

    A coarse log-magnitude spectrum (32 bins up to 4 kHz). Two clips with the
    same spectral envelope land close; different envelopes land apart. Good
    enough to exercise clustering / matching logic, not remotely production
    quality.
    """

    name = "stub"
    dim = 32

    def embed(self, pcm: np.ndarray) -> np.ndarray:
        pcm = np.asarray(pcm, dtype=np.float32)
        if pcm.size < 64:
            return _l2(np.ones(self.dim, dtype=np.float32))
        spectrum = np.abs(np.fft.rfft(pcm * np.hanning(pcm.size)))
        freqs = np.fft.rfftfreq(pcm.size, d=1.0 / 16000)
        mask = freqs <= 4000
        bins = np.array_split(spectrum[mask], self.dim)
        feats = np.array([b.mean() for b in bins], dtype=np.float32)
        return _l2(feats)


class OnnxEmbedder(Embedder):
    name = EMBED_MODEL_NAME

    def __init__(self) -> None:
        import onnxruntime as ort  # local import: optional dep

        path = self._ensure_model()
        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._input = self._session.get_inputs()[0].name
        self.dim = int(self._session.get_outputs()[0].shape[-1])

    @staticmethod
    def _ensure_model() -> str:
        models_dir = get_data_dir() / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        path = models_dir / "campplus_voxceleb.onnx"
        if path.exists() and _sha256(path) == EMBED_MODEL_SHA256:
            return str(path)
        logging.info("downloading speaker-embedding model to %s", path)
        tmp = path.with_suffix(".onnx.part")
        urllib.request.urlretrieve(EMBED_MODEL_URL, tmp)  # noqa: S310 - pinned host+sha
        digest = _sha256(tmp)
        if digest != EMBED_MODEL_SHA256:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"model sha256 mismatch: got {digest}")
        tmp.replace(path)
        return str(path)

    def _fbank(self, pcm: np.ndarray, sr: int = 16000) -> np.ndarray:
        import kaldi_native_fbank as knf  # local import: optional dep

        opts = knf.FbankOptions()
        opts.frame_opts.samp_freq = sr
        opts.frame_opts.dither = 0.0
        opts.frame_opts.snip_edges = False
        opts.mel_opts.num_bins = 80
        fb = knf.OnlineFbank(opts)
        fb.accept_waveform(sr, pcm.astype(np.float32).tolist())
        fb.input_finished()
        frames = [fb.get_frame(i) for i in range(fb.num_frames_ready)]
        if not frames:
            return np.zeros((1, 80), dtype=np.float32)
        feats = np.stack(frames).astype(np.float32)
        return feats - feats.mean(axis=0, keepdims=True)  # global-mean (per-utterance)

    def embed(self, pcm: np.ndarray) -> np.ndarray:
        feats = self._fbank(np.asarray(pcm, dtype=np.float32))
        out = self._session.run(None, {self._input: feats[None]})[0][0]
        return _l2(np.asarray(out, dtype=np.float32))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        kind = os.environ.get("CELTWO_MEMORY_EMBEDDER", "onnx").lower()
        if kind == "stub":
            logging.warning("CELTWO_MEMORY_EMBEDDER=stub — speaker labelling is NOT production quality")
            _embedder = StubEmbedder()
        else:
            _embedder = OnnxEmbedder()
    return _embedder

"""Legacy voiceprint processing.

The old cosine classifier remains for characterisation, but its score is not
a calibrated probability of identity. New processing leaves speaker unknown;
account-scoped participant suggestions require manual confirmation.
"""
from __future__ import annotations

import logging
import os

import numpy as np

from services.memory.storage import database

_MIN_WINDOW_MS = 2500
# Calibrated against real phone-channel data (162 segments): `other` mass sits
# below ~0.25, confident `me` above ~0.55, and 0.35–0.38 is the ambiguity gap.
_ME_THR = float(os.environ.get("CELTWO_MEMORY_DIAR_ME_THRESHOLD", "0.38"))
_OTHER_THR = float(os.environ.get("CELTWO_MEMORY_DIAR_OTHER_THRESHOLD", "0.35"))
_SR = 16000


def decode_pcm_16k_mono(path: str) -> np.ndarray:
    import av  # local import: optional dep (ships with faster-whisper)

    resampler = av.AudioResampler(format="s16", layout="mono", rate=_SR)
    chunks: list[np.ndarray] = []
    with av.open(path) as container:
        stream = container.streams.audio[0]
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):
            chunks.append(resampled.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    pcm = np.concatenate(chunks).astype(np.float32) / 32768.0
    return pcm


def _slice(pcm: np.ndarray, start_ms: int, end_ms: int) -> np.ndarray:
    if pcm.size == 0:
        return pcm
    if end_ms - start_ms < _MIN_WINDOW_MS:
        pad = (_MIN_WINDOW_MS - (end_ms - start_ms)) // 2
        start_ms -= pad
        end_ms += pad
    a = max(0, int(start_ms * _SR / 1000))
    b = min(pcm.size, int(end_ms * _SR / 1000))
    return pcm[a:b] if b > a else pcm[:1]


def _classify(sims: np.ndarray) -> list[str]:
    raw = [
        "me" if s >= _ME_THR else "other" if s <= _OTHER_THR else "unknown"
        for s in sims
    ]
    smoothed = list(raw)
    for i in range(1, len(raw) - 1):
        if raw[i] == "unknown" and raw[i - 1] == raw[i + 1] != "unknown":
            smoothed[i] = raw[i - 1]
    return smoothed


def label_chunk(session_id: str, chunk_num: int) -> dict[int, str]:
    voiceprint = database.get_voiceprint(database.get_session_owner(session_id))
    if voiceprint is None:
        return {}
    segments = database.get_segments_for_chunk(session_id, chunk_num)
    if not segments:
        return {}
    # A raw cosine score has no calibrated probability of identity. Keep the
    # enrolled reference, but do not turn it into an automatic "me" decision.
    # Account-scoped participant templates remain available as suggestions.
    result = {seg["id"]: "unknown" for seg in segments}

    if not database.set_chunk_speakers_if_voiceprint_current(
        session_id, chunk_num, voiceprint["updated_at"], result
    ):
        logging.info("voiceprint changed while labelling %s/%s; awaiting fresh task", session_id, chunk_num)
        return {}
    logging.info(
        "labelled %s/%s: %s", session_id, chunk_num,
        {v: list(result.values()).count(v) for v in set(result.values())},
    )
    return result

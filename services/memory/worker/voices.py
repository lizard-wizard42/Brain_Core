"""Session-local voice grouping ("who spoke when") without naming anyone.

Each transcript segment long enough to carry a voice is embedded and assigned to
a session voice (speaker_0, speaker_1, ...) by cosine similarity to running
centroids. Groups are only a reading aid: no identity is stored. The voice that
best matches the account's enrolled sample may be shown as "probably me"; it
becomes a real attribution only through the user's manual confirmation.
"""
from __future__ import annotations

import logging
import os
import sys

import numpy as np

from services.memory.storage import database
from services.memory.worker.diarizer import decode_pcm_16k_mono

_SR = 16000
_MAX_CHUNK_SECONDS = 300


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def enabled() -> bool:
    return os.environ.get("CELTWO_MEMORY_VOICE_GROUPING", "1") == "1"


def _assign_threshold() -> float:
    return _f("CELTWO_MEMORY_VOICE_ASSIGN_THRESHOLD", 0.55)


def _max_voices() -> int:
    return max(2, int(_f("CELTWO_MEMORY_VOICE_MAX", 6)))


def _min_ms() -> int:
    return int(_f("CELTWO_MEMORY_VOICE_MIN_MS", 2000))


def _unit(vec: np.ndarray) -> np.ndarray:
    vec = np.asarray(vec, dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-8 else vec


def _usable(clip: np.ndarray) -> bool:
    return (clip.size > 0 and bool(np.all(np.isfinite(clip)))
            and float(np.sqrt(np.mean(clip ** 2))) >= 0.01
            and float(np.mean(np.abs(clip) >= 0.99)) <= 0.01)


def assign_voices(session_id: str, chunk_num: int, embedder=None) -> dict[int, int]:
    """Group a chunk's segments into the session's voices. Idempotent per chunk.

    Returns {segment_id: voice_idx}; segments too short or unclear stay ungrouped
    unless both neighbours agree on one voice.
    """
    if not enabled():
        return {}
    segments = database.get_segments_for_chunk(session_id, chunk_num)
    if not segments or any(seg.get("voice_idx") is not None for seg in segments):
        return {}
    chunk = database.get_chunk(session_id, chunk_num)
    if chunk is None or not os.path.exists(chunk["path"]):
        return {}
    if embedder is None:
        from services.memory.storage.voice_templates import _local_embedder
        embedder = _local_embedder()
    pcm = decode_pcm_16k_mono(chunk["path"], max_samples=_MAX_CHUNK_SECONDS * _SR)

    voices = database.get_session_voices(session_id, embedder.name)
    threshold, limit, min_ms = _assign_threshold(), _max_voices(), _min_ms()
    picked: list[int | None] = []
    for seg in segments:
        a, b = round(seg["start_ms"] * _SR / 1000), round(seg["end_ms"] * _SR / 1000)
        if seg["end_ms"] - seg["start_ms"] < min_ms or a < 0 or b > pcm.size or not _usable(pcm[a:b]):
            picked.append(None)
            continue
        vec = _unit(embedder.embed(pcm[a:b]))
        if not np.all(np.isfinite(vec)) or not float(np.linalg.norm(vec)):
            picked.append(None)
            continue
        scored = [(float(np.dot(vec, v["centroid"])), idx) for idx, v in voices.items()
                  if v["centroid"].size == vec.size]
        best = max(scored, default=None)
        if best is not None and (best[0] >= threshold or len(voices) >= limit):
            idx = best[1]
            v = voices[idx]
            v["centroid"] = _unit(v["centroid"] * v["n"] + vec)
            v["n"] += 1
        else:
            idx = max(voices, default=-1) + 1
            voices[idx] = {"centroid": vec, "n": 1}
        picked.append(idx)

    # Short or unclear segments inherit a voice only when both neighbours agree.
    for i, idx in enumerate(picked):
        if idx is None and 0 < i < len(picked) - 1 and picked[i - 1] is not None \
                and picked[i - 1] == picked[i + 1]:
            if (segments[i]["start_ms"] - segments[i - 1]["end_ms"] <= 1500
                    and segments[i + 1]["start_ms"] - segments[i]["end_ms"] <= 1500):
                picked[i] = picked[i - 1]
    result = {seg["id"]: idx for seg, idx in zip(segments, picked) if idx is not None}
    database.save_chunk_voices(session_id, chunk_num, embedder.name, voices, result)
    return result


def active_voices(session_id: str, model: str) -> dict[int, dict]:
    """Voices with enough segments to be a speaker, not stray noise.

    A voice needs CELTWO_MEMORY_VOICE_MIN_SEGMENTS (default 3) segments and
    2% of the session's grouped segments, or at least six seconds of grouped
    speech. This avoids hiding a long utterance just because ASR kept it whole.
    """
    found = database.get_session_voices(session_id, model)
    total = sum(v["n"] for v in found.values())
    floor = max(int(_f("CELTWO_MEMORY_VOICE_MIN_SEGMENTS", 3)), int(0.02 * total))
    conn = database.get_connection()
    try:
        durations = dict(conn.execute(
            "SELECT voice_idx, SUM(MAX(0, end_ms-start_ms)) FROM transcript_segments "
            "WHERE session_id=? AND voice_idx IS NOT NULL GROUP BY voice_idx", (session_id,)
        ).fetchall())
    finally:
        conn.close()
    # ASR sentence boundaries are not evidence of different speakers: one long
    # utterance can carry more voice information than three tiny sentences.
    return {idx: v for idx, v in found.items()
            if v["n"] >= floor or durations.get(idx, 0) >= 6000}


def probable_owner_voices(session_id: str) -> set[int]:
    """Compare groups against account references, never against other groups.

    Confirmed templates complement enrollment across microphones. These are
    advisory labels only; manual identities and corrections remain authoritative.
    """
    from services.memory.storage.identities import owner_identity_id
    owner = database.get_session_owner(session_id)
    if not owner:
        return set()
    voiceprint = database.get_voiceprint(owner)
    if voiceprint is None:
        return set()
    model = voiceprint["model"]
    own_id = owner_identity_id(owner)
    refs = [(own_id, voiceprint["embedding"])]
    conn = database.get_connection()
    try:
        refs.extend((r["identity_id"], r["embedding"]) for r in conn.execute(
            "SELECT t.identity_id, t.embedding FROM voice_templates t "
            "JOIN voice_identities i ON i.id=t.identity_id AND i.owner_user_id=t.owner_user_id "
            "WHERE t.owner_user_id=? AND t.model=? AND t.deleted_at IS NULL AND i.deleted_at IS NULL",
            (owner, model)))
    finally:
        conn.close()
    vectors = []
    for identity, raw in refs:
        vec = np.frombuffer(raw, dtype=np.float32)
        if vec.size and np.all(np.isfinite(vec)) and np.linalg.norm(vec) > 1e-8:
            vectors.append((identity, _unit(vec)))
    result = set()
    # A group is already built from quality-gated clips of at least two
    # seconds. Do not apply the separate multi-utterance display gate before
    # comparing a short recording with a known reference.
    for idx, voice in database.get_session_voices(session_id, model).items():
        vec = _unit(voice["centroid"])
        if not np.all(np.isfinite(vec)) or np.linalg.norm(vec) < 1e-8:
            continue
        scores = {}
        for identity, ref in vectors:
            if ref.size == vec.size:
                scores[identity] = max(scores.get(identity, -1.0), float(np.dot(vec, ref)))
        own_score = scores.get(own_id, -1.0)
        competitor = max((score for identity, score in scores.items() if identity != own_id), default=-1.0)
        if (own_score >= _f("CELTWO_MEMORY_VOICE_ME_THRESHOLD", 0.5)
                and own_score - competitor >= _f("CELTWO_MEMORY_VOICE_ME_MARGIN", 0.1)):
            result.add(idx)
    return result


def me_probable_voice(session_id: str) -> int | None:
    """Compatibility helper for callers expecting a single group."""
    found = probable_owner_voices(session_id)
    return min(found) if found else None


def backfill(limit_sessions: int | None = None) -> int:
    """Group voices for existing sessions, oldest chunk first. Returns chunks processed."""
    done = 0
    for session_id in database.list_sessions_without_voices(limit_sessions):
        for chunk in database.get_chunks_for_session(session_id):
            try:
                if assign_voices(session_id, chunk["chunk_num"]):
                    done += 1
            except Exception:
                logging.exception("voice grouping %s/%s failed", session_id, chunk["chunk_num"])
    return done


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    database.init_db()
    count = backfill(int(sys.argv[1]) if len(sys.argv) > 1 else None)
    print(f"grouped {count} chunk(s)")

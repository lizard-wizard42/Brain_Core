"""Local, account-scoped voice suggestions from explicitly confirmed segments."""

import os
import uuid
import threading
from functools import wraps

import numpy as np

from services.memory.storage.database import _now_iso, get_connection, get_data_dir
from services.memory.storage.identities import owner_identity_id
from services.memory.worker.diarizer import decode_pcm_16k_mono
from services.memory.worker.embedder import EMBED_MODEL_NAME, EMBED_MODEL_SHA256, _sha256, get_embedder

_SR = 16000
_MIN_SECONDS = 3.0
_MIN_RMS = 0.01
_MAX_CLIPPED = 0.01
_MAX_CHUNK_SECONDS = 300
_MAX_SEGMENT_SECONDS = 60
_processing = threading.Lock()


class ParticipantProcessingBusy(ValueError):
    pass


class UnsuitableSegment(ValueError):
    """Valid account segment which cannot provide a reliable voice sample."""


def _bounded_processing(fn):
    @wraps(fn)
    def run(*args, **kwargs):
        if not _processing.acquire(blocking=False):
            raise ParticipantProcessingBusy("participant voice processing is busy")
        try:
            return fn(*args, **kwargs)
        finally:
            _processing.release()
    return run


def _local_embedder():
    # The normal ONNX embedder can download a missing model. This path must stay local.
    if os.environ.get("CELTWO_MEMORY_EMBEDDER", "onnx").lower() != "stub":
        model_path = get_data_dir() / "models" / "campplus_voxceleb.onnx"
        if not model_path.is_file() or _sha256(model_path) != EMBED_MODEL_SHA256:
            raise ValueError("local voice embedding model is unavailable")
    return get_embedder()


def _source(conn, owner: str, segment_id: int, require_confirmed: bool):
    row = conn.execute(
        "SELECT ts.id, ts.session_id, ts.chunk_num, ts.start_ms, ts.end_ms, "
        "c.path, c.audio_purged_at FROM transcript_segments ts "
        "JOIN sessions s ON s.id=ts.session_id AND s.owner_user_id=? "
        "JOIN chunks c ON c.session_id=ts.session_id AND c.chunk_num=ts.chunk_num "
        "WHERE ts.id=?", (owner, segment_id),
    ).fetchone()
    if row is None:
        raise ValueError("segment audio unavailable for account")
    if row["audio_purged_at"]:
        raise UnsuitableSegment("segment audio has been purged")
    if require_confirmed:
        decision = conn.execute(
            "SELECT d.identity_id, d.action FROM segment_identity_decisions d "
            "WHERE d.owner_user_id=? AND d.segment_id=? ORDER BY d.id DESC LIMIT 1",
            (owner, segment_id),
        ).fetchone()
        if decision is None or decision["action"] not in ("confirm", "correct"):
            raise ValueError("segment has no current manual confirmation")
        identity = conn.execute(
            "SELECT 1 FROM voice_identities WHERE id=? AND owner_user_id=? AND deleted_at IS NULL",
            (decision["identity_id"], owner),
        ).fetchone()
        if identity is None:
            raise ValueError("confirmed identity is unavailable")
    else:
        decision = None
    overlap = conn.execute(
        "SELECT 1 FROM transcript_segments WHERE session_id=? AND chunk_num=? "
        "AND id!=? AND start_ms<? AND end_ms>? LIMIT 1",
        (row["session_id"], row["chunk_num"], segment_id, row["end_ms"], row["start_ms"]),
    ).fetchone()
    if overlap:
        raise UnsuitableSegment("segment overlaps another speaker interval")
    return row, decision


def _embedding(row, embedder):
    start, end = row["start_ms"], row["end_ms"]
    if start < 0 or (end - start) < _MIN_SECONDS * 1000:
        raise UnsuitableSegment("segment is too short")
    if end - start > _MAX_SEGMENT_SECONDS * 1000:
        raise UnsuitableSegment("segment exceeds 60 seconds")
    pcm = decode_pcm_16k_mono(row["path"], max_samples=_MAX_CHUNK_SECONDS * _SR)
    if end > pcm.size * 1000 / _SR:
        raise UnsuitableSegment("segment extends beyond audio")
    clip = pcm[round(start * _SR / 1000):round(end * _SR / 1000)]
    if not np.all(np.isfinite(clip)) or float(np.sqrt(np.mean(clip ** 2))) < _MIN_RMS:
        raise UnsuitableSegment("segment audio quality is insufficient")
    if float(np.mean(np.abs(clip) >= 0.99)) > _MAX_CLIPPED:
        raise UnsuitableSegment("segment audio is clipped")
    vec = np.asarray(embedder.embed(clip), dtype=np.float32)
    norm = float(np.linalg.norm(vec))
    if vec.ndim != 1 or not np.all(np.isfinite(vec)) or norm < 1e-8:
        raise ValueError("invalid voice embedding")
    return vec / norm


@_bounded_processing
def create_template(owner: str, segment_id: int, embedder=None) -> dict:
    if not owner:
        raise ValueError("owner_user_id is required")
    conn = get_connection()
    try:
        row, decision = _source(conn, owner, segment_id, True)
        existing = conn.execute(
            "SELECT id, model FROM voice_templates WHERE owner_user_id=? "
            "AND source_segment_id=? AND deleted_at IS NULL", (owner, segment_id),
        ).fetchone()
        if existing:
            raise ValueError("segment already has a template; delete it before re-extraction")
        encoder = embedder or _local_embedder()
        vector = _embedding(row, encoder)
        # Expensive decoding/inference never holds the shared SQLite writer lock.
        conn.execute("BEGIN IMMEDIATE")
        current_row, current_decision = _source(conn, owner, segment_id, True)
        if dict(current_row) != dict(row) or dict(current_decision) != dict(decision):
            raise ValueError("segment or manual confirmation changed during processing")
        if conn.execute("SELECT 1 FROM voice_templates WHERE owner_user_id=? "
                        "AND source_segment_id=? AND deleted_at IS NULL", (owner, segment_id)).fetchone():
            raise ValueError("segment already has a template; delete it before re-extraction")
        template_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO voice_templates (id, owner_user_id, identity_id, embedding, model, dim, "
            "sample_seconds, source_segment_id, source_session_id, source_chunk_num, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (template_id, owner, decision["identity_id"], vector.tobytes(), encoder.name,
             vector.size, (row["end_ms"] - row["start_ms"]) / 1000, segment_id,
             row["session_id"], row["chunk_num"], _now_iso()),
        )
        conn.commit()
        return {"id": template_id, "identity_id": decision["identity_id"],
                "model": encoder.name, "source_segment_id": segment_id}
    finally:
        conn.close()


def delete_template(owner: str, template_id: str) -> bool:
    conn = get_connection()
    try:
        changed = conn.execute(
            "UPDATE voice_templates SET deleted_at=? WHERE id=? AND owner_user_id=? AND deleted_at IS NULL",
            (_now_iso(), template_id, owner),
        ).rowcount
        conn.commit()
        return bool(changed)
    finally:
        conn.close()


def _templates(conn, owner, model, segment_id):
    return conn.execute(
        "SELECT t.id, t.identity_id, t.embedding, t.dim, i.display_name "
        "FROM voice_templates t JOIN voice_identities i ON i.id=t.identity_id "
        "AND i.owner_user_id=t.owner_user_id AND i.deleted_at IS NULL "
        "WHERE t.owner_user_id=? AND t.model=? AND t.deleted_at IS NULL "
        "AND t.source_segment_id!=?", (owner, model, segment_id),
    ).fetchall()


def suggest_segment(owner: str, segment_id: int, embedder=None, limit: int = 3) -> list[dict]:
    if not owner:
        raise ValueError("owner_user_id is required")
    conn = get_connection()
    try:
        try:
            row, _ = _source(conn, owner, segment_id, False)
        except UnsuitableSegment:
            return []
        # Cheap reads must not compete for inference admission. Most ASR text
        # segments are shorter than a useful speaker sample.
        duration = row["end_ms"] - row["start_ms"]
        if row["start_ms"] < 0 or not _MIN_SECONDS * 1000 <= duration <= _MAX_SEGMENT_SECONDS * 1000:
            return []
        model = embedder.name if embedder else (
            "stub" if os.environ.get("CELTWO_MEMORY_EMBEDDER", "onnx").lower() == "stub" else EMBED_MODEL_NAME)
        templates = _templates(conn, owner, model, segment_id)
        voice = conn.execute(
            "SELECT embedding, dim, updated_at FROM account_voiceprints WHERE owner_user_id=? AND model=?",
            (owner, model),
        ).fetchone()
        if not templates and voice is None:
            return []
        try:
            vector = _suggestion_embedding(row, embedder)
        except UnsuitableSegment:
            return []
        # A manual correction/deletion can invalidate references while the
        # expensive comparison runs. Do not propose the stale attribution.
        templates = _templates(conn, owner, model, segment_id)
        if voice is not None:
            current = conn.execute("SELECT updated_at FROM account_voiceprints WHERE owner_user_id=?", (owner,)).fetchone()
            if current and current["updated_at"] == voice["updated_at"]:
                templates = [*templates, {"id": None, "identity_id": owner_identity_id(owner),
                    "embedding": voice["embedding"], "dim": voice["dim"], "display_name": "Minha voz"}]
        scores = {}
        for item in templates:
            ref = np.frombuffer(item["embedding"], dtype=np.float32)
            if item["dim"] != vector.size or ref.size != vector.size or not np.all(np.isfinite(ref)) or np.linalg.norm(ref) < 1e-8:
                continue
            score = float(np.dot(vector, ref) / (np.linalg.norm(ref) or 1))
            previous = scores.get(item["identity_id"])
            if previous is None or score > previous["similarity"]:
                scores[item["identity_id"]] = {"identity_id": item["identity_id"],
                    "display_name": item["display_name"], "similarity": round(score, 4),
                    "model": model, "template_id": item["id"]}
        return sorted(scores.values(), key=lambda x: x["similarity"], reverse=True)[:max(0, limit)]
    finally:
        conn.close()


@_bounded_processing
def _suggestion_embedding(row, embedder):
    return _embedding(row, embedder or _local_embedder())

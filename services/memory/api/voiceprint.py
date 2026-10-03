"""Fase 7 — enrollment of the user's reference voiceprint.

The client POSTs a short raw audio recording (webm/opus/wav — anything PyAV
decodes) as the request body. We embed it and store a single reference
vector; every existing chunk is queued for re-labelling. GET reports status
only (never the vector); DELETE clears it and resets every segment's speaker.
"""
import os
import asyncio
import tempfile
import threading
from contextlib import contextmanager

import numpy as np
from fastapi import APIRouter, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from services.memory.api.chunks import require_token, valid_owner
from services.memory.storage import database
from services.memory.worker.diarizer import AudioSampleBudget, AudioSampleLimitExceeded, decode_pcm_16k_mono
from services.memory.worker.embedder import get_embedder

router = APIRouter()

_MIN_SECONDS = float(os.environ.get("CELTWO_MEMORY_VOICEPRINT_MIN_SECONDS", "8"))
_SR = 16000
_WINDOW = 3 * _SR
_MAX_SECONDS = 60
_MAX_SAMPLES = _MAX_SECONDS * _SR
_MAX_BYTES = 25 * 1024 * 1024
_MAX_SESSION_CHUNKS = 128
_enrollment_lock = threading.Lock()
_enrollment_tasks: set[asyncio.Task] = set()


def _acquire_enrollment_slot() -> None:
    if not _enrollment_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="voice enrollment busy; try again shortly")


@contextmanager
def _enrollment_slot():
    # Reject concurrent jobs rather than accumulating audio/inference work.
    _acquire_enrollment_slot()
    try:
        yield
    finally:
        _enrollment_lock.release()


def _too_long() -> HTTPException:
    return HTTPException(status_code=413, detail=f"voice sample must be at most {_MAX_SECONDS}s; send a shorter recording")


def _decode_and_store(path: str, owner_user_id: str | None) -> dict:
    try:
        pcm = decode_pcm_16k_mono(path, max_samples=_MAX_SAMPLES)
    except AudioSampleLimitExceeded as exc:
        raise _too_long() from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="could not decode audio") from exc
    return _store(pcm, owner_user_id=owner_user_id)


def _finish_enrollment(tmp, owner_user_id: str | None) -> dict:
    # Ownership transfers to the worker: request cancellation must not release
    # the slot or delete its input while native decoding/inference still runs.
    try:
        return _decode_and_store(tmp.name, owner_user_id)
    finally:
        try:
            tmp.close()
        finally:
            _enrollment_lock.release()


def _enrollment_finished(task: asyncio.Task) -> None:
    _enrollment_tasks.discard(task)
    if not task.cancelled():
        task.exception()  # Retrieve errors even when the requesting client left.


def _embed_windowed(pcm: np.ndarray) -> np.ndarray:
    """Average embeddings over 3s windows — steadier than one embed of a long clip."""
    embedder = get_embedder()
    windows = [pcm[i:i + _WINDOW] for i in range(0, max(1, pcm.size - _SR), _WINDOW)]
    vectors = [embedder.embed(w) for w in windows if w.size > _SR]
    if not vectors:
        vectors = [embedder.embed(pcm)]
    mean = np.mean(vectors, axis=0).astype("float32")
    return mean / (float(np.linalg.norm(mean)) or 1.0)


def _store(pcm: np.ndarray, model_suffix: str = "", owner_user_id: str | None = None) -> dict:
    if pcm.size > _MAX_SAMPLES:
        raise _too_long()
    seconds = round(pcm.size / _SR, 2)
    if seconds < _MIN_SECONDS:
        raise HTTPException(status_code=400, detail=f"need at least {_MIN_SECONDS:g}s of audio, got {seconds:g}s")
    vector = _embed_windowed(pcm)
    embedder = get_embedder()
    model = embedder.name + model_suffix
    database.set_voiceprint(vector.tobytes(), int(vector.size), seconds, model, owner_user_id)
    database.enqueue_relabel_all(owner_user_id)
    return {"enrolled": True, "sample_seconds": seconds, "model": model}


def _status_payload(owner_user_id: str | None = None) -> dict:
    vp = database.get_voiceprint(owner_user_id)
    if vp is None:
        return {"enrolled": False, "updated_at": None, "sample_seconds": None, "model": None,
                "relabel": database.relabel_counts(owner_user_id)}
    return {
        "enrolled": True,
        "updated_at": vp["updated_at"],
        "sample_seconds": vp["sample_seconds"],
        "model": vp["model"],
        "relabel": database.relabel_counts(owner_user_id),
    }


@router.get("/voiceprint")
def get_voiceprint(owner_user_id: str | None = None,
                   authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    if owner_user_id is not None:
        owner_user_id = valid_owner(owner_user_id)
    return _status_payload(owner_user_id)


@router.post("/voiceprint", status_code=201)
async def enroll_voiceprint(
    request: Request, owner_user_id: str | None = None,
    authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)
    if owner_user_id is not None:
        owner_user_id = valid_owner(owner_user_id)
    _acquire_enrollment_slot()
    tmp = None
    transferred = False
    try:
        tmp = tempfile.NamedTemporaryFile(suffix=".audio", delete=True)
        size = 0
        async for block in request.stream():
            size += len(block)
            if size > _MAX_BYTES:
                raise HTTPException(status_code=413, detail="voice sample must be at most 25 MiB")
            tmp.write(block)
        if not size:
            raise HTTPException(status_code=400, detail="empty audio body")
        tmp.flush()
        task = asyncio.create_task(run_in_threadpool(_finish_enrollment, tmp, owner_user_id))
        _enrollment_tasks.add(task)
        task.add_done_callback(_enrollment_finished)
        transferred = True
        return await asyncio.shield(task)
    finally:
        if not transferred:
            try:
                if tmp is not None:
                    tmp.close()
            finally:
                _enrollment_lock.release()


@router.post("/voiceprint/from-session/{session_id}", status_code=201)
def enroll_from_session(session_id: str, owner_user_id: str | None = None,
                        authorization: str | None = Header(default=None)) -> dict:
    """Build the reference from an existing recording — same mic/channel as the
    sessions we label, which matters a lot for cross-channel robustness."""
    require_token(authorization)
    if owner_user_id is not None:
        owner_user_id = valid_owner(owner_user_id)
    if not database.session_exists(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    if database.get_session_owner(session_id) != owner_user_id:
        raise HTTPException(status_code=404, detail="session not found")
    with _enrollment_slot():
        chunks = database.get_chunks_for_session(session_id, limit=_MAX_SESSION_CHUNKS + 1)
        if not chunks:
            raise HTTPException(status_code=400, detail="session has no audio")
        if len(chunks) > _MAX_SESSION_CHUNKS:
            raise HTTPException(status_code=413, detail="too many audio blocks; send a short voice recording instead")
        parts = []
        samples = size = 0
        budget = AudioSampleBudget(_MAX_SAMPLES)
        for chunk in chunks:
            try:
                size += os.path.getsize(chunk["path"])
                if size > _MAX_BYTES:
                    raise HTTPException(status_code=413, detail="voice sample must be at most 25 MiB in total")
                pcm = decode_pcm_16k_mono(chunk["path"], sample_budget=budget)
                samples += pcm.size
                if samples > _MAX_SAMPLES:
                    raise _too_long()
                parts.append(pcm)
            except AudioSampleLimitExceeded as exc:
                raise _too_long() from exc
            except HTTPException:
                raise
            except Exception:  # Skip corrupt chunks, but never swallow budget failures.
                continue
        pcm = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        return _store(pcm, model_suffix="+session", owner_user_id=owner_user_id)


@router.delete("/voiceprint")
def delete_voiceprint(owner_user_id: str | None = None,
                      authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    database.clear_voiceprint(owner_user_id)
    database.clear_relabel_for_owner(owner_user_id)
    database.clear_all_speakers(owner_user_id)
    return {"enrolled": False}

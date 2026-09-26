"""Fase 7 — enrollment of the user's reference voiceprint.

The client POSTs a short raw audio recording (webm/opus/wav — anything PyAV
decodes) as the request body. We embed it and store a single reference
vector; every existing chunk is queued for re-labelling. GET reports status
only (never the vector); DELETE clears it and resets every segment's speaker.
"""
import os
import tempfile

import numpy as np
from fastapi import APIRouter, Header, HTTPException, Request

from services.memory.api.chunks import require_token
from services.memory.storage import database
from services.memory.worker.diarizer import decode_pcm_16k_mono
from services.memory.worker.embedder import get_embedder

router = APIRouter()

_MIN_SECONDS = float(os.environ.get("CELTWO_MEMORY_VOICEPRINT_MIN_SECONDS", "8"))
_SR = 16000
_WINDOW = 3 * _SR


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
def get_voiceprint(owner_user_id: str | None = None) -> dict:
    return _status_payload(owner_user_id)


@router.post("/voiceprint", status_code=201)
async def enroll_voiceprint(
    request: Request, owner_user_id: str | None = None,
    authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="empty audio body")

    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
        tmp.write(body)
        tmp.flush()
        try:
            pcm = decode_pcm_16k_mono(tmp.name)
        except Exception as exc:  # noqa: BLE001 - surface decode failures as 400
            raise HTTPException(status_code=400, detail=f"could not decode audio: {exc}") from exc

    return _store(pcm, owner_user_id=owner_user_id)


@router.post("/voiceprint/from-session/{session_id}", status_code=201)
def enroll_from_session(session_id: str, owner_user_id: str | None = None,
                        authorization: str | None = Header(default=None)) -> dict:
    """Build the reference from an existing recording — same mic/channel as the
    sessions we label, which matters a lot for cross-channel robustness."""
    require_token(authorization)
    if not database.session_exists(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    if database.get_session_owner(session_id) != owner_user_id:
        raise HTTPException(status_code=404, detail="session not found")
    chunks = database.get_chunks_for_session(session_id)
    if not chunks:
        raise HTTPException(status_code=400, detail="session has no audio")
    parts = []
    for chunk in chunks:
        try:
            parts.append(decode_pcm_16k_mono(chunk["path"]))
        except Exception:  # noqa: BLE001 - skip an undecodable chunk, keep the rest
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

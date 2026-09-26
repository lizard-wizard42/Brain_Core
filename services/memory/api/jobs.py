"""Fase 9 — endpoints do worker de transcrição por GPU e fila de jobs."""
import logging
import os

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel

from services.memory.api.chunks import require_token
from services.memory.storage import database
from services.memory.api.transcription_policy import claim_allowed_owners
from services.memory.worker.transcriber import (
    TranscribedSegment, _looks_silent, build_initial_prompt, collapse_repeats,
)

router = APIRouter()


class ClaimBody(BaseModel):
    worker: str = "gpu"


@router.post("/jobs/claim", response_model=None)
@router.post("/api/v1/jobs/claim", response_model=None)
def post_jobs_claim(
    body: ClaimBody, authorization: str | None = Header(default=None)
) -> Response | dict:
    require_token(authorization)
    job = database.claim_next_job(body.worker[:32] or "gpu", claim_allowed_owners())
    if job is None:
        return Response(status_code=204)
    return {
        "job_id": job["id"],
        "session_id": job["session_id"],
        "chunk_num": job["chunk_num"],
        "owner_user_id": database.get_session_owner(job["session_id"]),
        "initial_prompt": build_initial_prompt(job["session_id"], job["chunk_num"]),
    }


@router.get("/chunks/{session_id}/{chunk_num}/audio")
@router.get("/api/v1/chunks/{session_id}/{chunk_num}/audio")
def get_chunk_audio(
    session_id: str, chunk_num: int, authorization: str | None = Header(default=None)
) -> Response:
    require_token(authorization)
    chunk = database.get_chunk(session_id, chunk_num)
    if chunk is None or not os.path.exists(chunk["path"]):
        raise HTTPException(status_code=404, detail="chunk audio not available")
    with open(chunk["path"], "rb") as fh:
        data = fh.read()

    path = chunk["path"].lower()
    if path.endswith(".m4a") or path.endswith(".mp4"):
        media_type = "audio/mp4"
    elif path.endswith(".aac"):
        media_type = "audio/aac"
    elif path.endswith(".wav"):
        media_type = "audio/wav"
    elif path.endswith(".ogg") or path.endswith(".opus"):
        media_type = "audio/ogg"
    else:
        media_type = "application/octet-stream"

    return Response(content=data, media_type=media_type)


_DENOISED_MAX_BYTES = 15 * 1024 * 1024


@router.post("/chunks/{session_id}/{chunk_num}/denoised")
@router.post("/api/v1/chunks/{session_id}/{chunk_num}/denoised")
async def post_chunk_denoised(
    session_id: str, chunk_num: int, request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    require_token(authorization)
    chunk = database.get_chunk(session_id, chunk_num)
    if chunk is None:
        raise HTTPException(status_code=404, detail="chunk not found")
    data = await request.body()
    if not data or len(data) > _DENOISED_MAX_BYTES:
        raise HTTPException(status_code=400, detail="corpo vazio ou grande demais")
    base = os.path.splitext(chunk["path"])[0]
    out = f"{base}.denoised.ogg"
    with open(out, "wb") as fh:
        fh.write(data)
    database.set_chunk_denoised(session_id, chunk_num, out)
    return {"stored": len(data)}


class JobFailBody(BaseModel):
    error_type: str = "transcription_error"
    message: str = ""
    worker: str = "gpu"


@router.post("/jobs/{job_id}/fail")
@router.post("/api/v1/jobs/{job_id}/fail")
def post_job_fail(
    job_id: int, body: JobFailBody, authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)
    job = database.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "processing":
        raise HTTPException(status_code=409, detail="job not processing")

    max_attempts = int(os.environ.get("CELTWO_MEMORY_WORKER_MAX_ATTEMPTS", "3"))
    new_status = database.mark_job_retry_or_failed(job_id, job["attempts"], max_attempts)
    logging.warning(
        "job %s (%s chunk %s) falhou (%s: %s). Novo status: %s (tentativa %s/%s)",
        job_id, job["session_id"], job["chunk_num"], body.error_type, body.message,
        new_status, job["attempts"] + 1, max_attempts
    )
    return {"status": new_status, "job_id": job_id, "attempts": job["attempts"] + 1}


class SegmentIn(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class SegmentsBody(BaseModel):
    segments: list[SegmentIn]
    model: str | None = None
    completed: bool = True


@router.post("/jobs/{job_id}/segments")
@router.post("/api/v1/jobs/{job_id}/segments")
def post_job_segments(
    job_id: int, body: SegmentsBody, authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)
    job = database.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "processing":
        raise HTTPException(status_code=409, detail="job not processing")

    segs = collapse_repeats([
        TranscribedSegment(s.start_ms, s.end_ms, s.text.strip()) for s in body.segments
    ])
    chunk = database.get_chunk(job["session_id"], job["chunk_num"])
    max_attempts = int(os.environ.get("CELTWO_MEMORY_WORKER_MAX_ATTEMPTS", "3"))

    # Se a inferência não foi concluída normalmente ou modelo ausente
    if not body.completed or body.model is None:
        new_status = database.mark_job_retry_or_failed(job_id, job["attempts"], max_attempts)
        return {"status": new_status}

    # Se lista vazia com model preenchido: validar se áudio tem indício de silêncio ou se inferência sem fala
    if not segs:
        # Se chunk existe e tem áudio audível mas worker enviou vazio sem fala comprovada
        if chunk is not None and not _looks_silent(chunk["path"]):
            # Silêncio não comprovado no áudio audível -> retentar para não perder conteúdo
            logging.info("job %s vazio em áudio audível, agendando retry", job_id)
            new_status = database.mark_job_retry_or_failed(job_id, job["attempts"], max_attempts)
            return {"status": new_status}

    database.insert_segments(job["session_id"], job["chunk_num"], segs)
    database.mark_job_done(job_id, body.model)
    try:
        from services.memory.worker.diarizer import label_chunk
        label_chunk(job["session_id"], job["chunk_num"])
    except Exception:
        logging.exception("label_chunk %s/%s falhou", job["session_id"], job["chunk_num"])
        database.enqueue_relabel(job["session_id"], job["chunk_num"])
    return {"status": "done", "segments": len(segs)}

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import os
import re
import sqlite3
import uuid

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel

from services.memory.storage import database

router = APIRouter()

_SESSION_ID_PATTERN = re.compile(r"^(\d{8})T(\d{6})-\d+$")
_chunk_locks: dict[tuple[str, int], asyncio.Lock] = {}
_chunk_locks_guard = asyncio.Lock()


@asynccontextmanager
async def _chunk_lock(session_id: str, chunk_num: int):
    async with _chunk_locks_guard:
        if (session_id, chunk_num) not in _chunk_locks:
            _chunk_locks[(session_id, chunk_num)] = asyncio.Lock()
        lock = _chunk_locks[(session_id, chunk_num)]
    async with lock:
        yield


def parse_started_at(session_id: str) -> str:
    match = _SESSION_ID_PATTERN.match(session_id)
    if not match:
        raise ValueError(f"cannot parse started_at from session_id: {session_id}")
    date_part, time_part = match.groups()
    year, month, day = date_part[:4], date_part[4:6], date_part[6:8]
    hour, minute, second = time_part[:2], time_part[2:4], time_part[4:6]
    return f"{year}-{month}-{day}T{hour}:{minute}:{second}Z"


def _now_utc_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _detect_audio_extension(content_type: str | None) -> str:
    if not content_type:
        return ".opus"
    ct = content_type.lower().split(";")[0].strip()
    if ct in ("audio/mp4", "audio/m4a", "audio/x-m4a"):
        return ".m4a"
    if ct == "audio/aac":
        return ".aac"
    if ct in ("audio/wav", "audio/x-wav", "audio/wave"):
        return ".wav"
    if ct in ("audio/ogg", "audio/opus", "audio/x-opus+ogg"):
        return ".opus"
    return ".opus"


def require_token(authorization: str | None) -> None:
    api_token = os.environ.get("CELTWO_MEMORY_API_TOKEN", "").strip()
    if not api_token:
        raise HTTPException(
            status_code=401,
            detail="authentication required: CELTWO_MEMORY_API_TOKEN is not configured",
        )
    expected = f"Bearer {api_token}"
    provided = (authorization or "").strip().encode("utf-8", "surrogateescape")
    if not hmac.compare_digest(provided, expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid or missing token")


def valid_owner(owner_user_id: str) -> str:
    try:
        return str(uuid.UUID(owner_user_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid owner_user_id") from exc


@router.post("/chunks", status_code=201)
@router.post("/api/v1/chunks", status_code=201)
async def upload_chunk(
    request: Request,
    response: Response,
    session_id: str,
    chunk_num: int,
    device_id: str,
    sha256: str,
    started_at: str | None = None,
    chunk_started_at: str | None = None,
    owner_user_id: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict:
    require_token(authorization)

    if "/" in session_id or "\\" in session_id or ".." in session_id:
        raise HTTPException(status_code=400, detail="invalid session_id")

    body = await request.body()
    computed_sha256 = hashlib.sha256(body).hexdigest()
    if computed_sha256 != sha256:
        raise HTTPException(status_code=400, detail="sha256 mismatch")

    if owner_user_id is not None:
        try:
            owner_user_id = str(uuid.UUID(owner_user_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid owner_user_id") from exc

    if chunk_started_at:
        from datetime import datetime
        try:
            parsed_chunk_start = datetime.fromisoformat(chunk_started_at.replace("Z", "+00:00"))
            if parsed_chunk_start.tzinfo is None:
                raise ValueError("timezone required")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid chunk_started_at") from exc

    async with _chunk_lock(session_id, chunk_num):
        if started_at and started_at.strip():
            effective_started_at = started_at.strip()
        else:
            try:
                effective_started_at = parse_started_at(session_id)
            except ValueError:
                effective_started_at = _now_utc_iso()
        try:
            database.create_session_if_missing(session_id, device_id, effective_started_at, owner_user_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        existing = database.get_chunk(session_id, chunk_num)
        if existing is not None:
            if existing.get("sha256") == sha256:
                response.status_code = 200
                return {"sha256": sha256, "status": "already_stored"}
            raise HTTPException(
                status_code=409,
                detail="chunk already exists with different sha256",
            )

        clean_date = re.sub(r"[^0-9]", "", effective_started_at)
        if len(clean_date) >= 8:
            year, month, day = clean_date[0:4], clean_date[4:6], clean_date[6:8]
        else:
            now_str = _now_utc_iso().replace("-", "")
            year, month, day = now_str[0:4], now_str[4:6], now_str[6:8]

        chunk_dir = database.get_data_dir() / "audio" / year / month / day / session_id
        chunk_dir.mkdir(parents=True, exist_ok=True)

        ext = _detect_audio_extension(request.headers.get("content-type"))
        chunk_path = chunk_dir / f"chunk-{chunk_num:04d}{ext}"
        tmp_path = chunk_dir / f".chunk-{chunk_num:04d}-{os.getpid()}-{uuid.uuid4().hex[:8]}.tmp"

        try:
            with open(tmp_path, "wb") as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())

            # Double check database before replacing
            existing = database.get_chunk(session_id, chunk_num)
            if existing is not None:
                if existing.get("sha256") == sha256:
                    response.status_code = 200
                    return {"sha256": sha256, "status": "already_stored"}
                raise HTTPException(
                    status_code=409,
                    detail="chunk already exists with different sha256",
                )

            if chunk_path.exists():
                with open(chunk_path, "rb") as f:
                    existing_disk_sha = hashlib.sha256(f.read()).hexdigest()
                if existing_disk_sha != sha256:
                    raise HTTPException(
                        status_code=409,
                        detail="chunk already exists with different sha256",
                    )

            os.replace(tmp_path, chunk_path)

            try:
                database.insert_chunk(session_id, chunk_num, sha256, len(body), str(chunk_path), chunk_started_at)
            except sqlite3.IntegrityError:
                existing = database.get_chunk(session_id, chunk_num)
                if existing is not None and existing.get("sha256") == sha256:
                    response.status_code = 200
                    return {"sha256": sha256, "status": "already_stored"}
                raise HTTPException(
                    status_code=409,
                    detail="chunk already exists with different sha256",
                )

            database.create_job_if_missing(session_id, chunk_num)
            return {"sha256": sha256, "status": "stored"}
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass


class SessionCompleteRequest(BaseModel):
    status: str


@router.post("/sessions/{session_id}/complete")
@router.post("/api/v1/sessions/{session_id}/complete")
def complete_session_route(
    session_id: str,
    payload: SessionCompleteRequest,
    authorization: str | None = Header(default=None),
) -> dict:
    require_token(authorization)

    if payload.status not in ("stopped", "failed"):
        raise HTTPException(status_code=400, detail="status must be 'stopped' or 'failed'")

    if not database.complete_session(session_id, payload.status):
        raise HTTPException(status_code=404, detail="session not found")

    return {"session_id": session_id, "status": payload.status}

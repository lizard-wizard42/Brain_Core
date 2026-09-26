"""Per-account retention for PC audio after every chunk has a finished job."""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.memory.api.chunks import _chunk_lock, require_token
from services.memory.storage import database

router = APIRouter()
ALLOWED_DAYS = {30, 90, 180, 365}


class Policy(BaseModel):
    automatic: bool
    days: int


def owner_id(value: str) -> str:
    try:
        parsed = str(uuid.UUID(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid owner_user_id") from exc
    return parsed


def cutoff(days: int) -> str:
    if days not in ALLOWED_DAYS:
        raise HTTPException(status_code=400, detail="invalid retention days")
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def candidates(owner: str, days: int) -> list[dict]:
    return database.audio_cleanup_candidates(owner, cutoff(days))


def safe_file(raw: str | None) -> Path | None:
    if not raw:
        return None
    root = (database.get_data_dir() / "audio").resolve()
    file = Path(raw).resolve()
    return file if file.is_relative_to(root) and file != root else None


@router.get("/api/v1/audio-retention/{owner_user_id}")
def get_policy(owner_user_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    return database.get_audio_retention(owner_id(owner_user_id))


@router.put("/api/v1/audio-retention/{owner_user_id}")
def put_policy(owner_user_id: str, body: Policy, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    cutoff(body.days)
    return database.set_audio_retention(owner_id(owner_user_id), body.automatic, body.days)


@router.get("/api/v1/audio-retention/{owner_user_id}/preview")
def preview(owner_user_id: str, days: int, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    rows = candidates(owner_id(owner_user_id), days)
    return {"files": len(rows), "bytes": sum(row["size_bytes"] for row in rows)}


async def clean_owner(owner: str, days: int) -> dict:
    removed = 0
    bytes_freed = 0
    for row in candidates(owner, days):
        async with _chunk_lock(row["session_id"], row["chunk_num"]):
            # A worker can finish or an upload can arrive after the first query.
            if not database.audio_cleanup_candidates(owner, cutoff(days), row["session_id"], row["chunk_num"]):
                continue
            paths = [safe_file(row["path"]), safe_file(row["denoised_path"])]
            if paths[0] is None or (row["denoised_path"] and paths[1] is None):
                continue
            try:
                size = sum(path.stat().st_size for path in paths if path and path.is_file())
                for path in paths:
                    if path and path.is_file():
                        path.unlink()
                if database.mark_audio_purged(row["session_id"], row["chunk_num"], row["path"]):
                    removed += 1
                    bytes_freed += size
            except OSError:
                logging.exception("audio retention failed for %s/%s", row["session_id"], row["chunk_num"])
    return {"files": removed, "bytes": bytes_freed}


@router.post("/api/v1/audio-retention/{owner_user_id}/cleanup")
async def cleanup(owner_user_id: str, days: int, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    return await clean_owner(owner_id(owner_user_id), days)


async def automatic_cleanup_loop() -> None:
    while True:
        try:
            for policy in database.automatic_audio_retention_policies():
                if policy["days"] in ALLOWED_DAYS:
                    await clean_owner(policy["owner_user_id"], policy["days"])
        except Exception:
            logging.exception("automatic audio retention failed")
        await asyncio.sleep(24 * 60 * 60)

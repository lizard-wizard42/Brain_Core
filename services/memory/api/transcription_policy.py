"""Per-account GPU admission control; active jobs finish when a policy is paused."""
import re
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel

from services.memory.api.chunks import require_token
from services.memory.storage import database

router = APIRouter()
MODES = {"automatic", "scheduled", "manual"}
WINDOW_HOURS = {2, 4, 8, 12}
TIMEZONES = {"America/Sao_Paulo", "UTC"}


class Policy(BaseModel):
    mode: str
    start_time: str = "22:00"
    window_hours: int = 8
    timezone: str = "America/Sao_Paulo"


def owner_id(raw: str) -> str:
    try:
        return str(uuid.UUID(raw))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid owner_user_id") from exc


def validate(body: Policy) -> None:
    if body.mode not in MODES or body.window_hours not in WINDOW_HOURS or body.timezone not in TIMEZONES:
        raise HTTPException(status_code=400, detail="invalid transcription policy")
    if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", body.start_time):
        raise HTTPException(status_code=400, detail="invalid start_time")


def allowed(policy: dict, now: datetime | None = None) -> bool:
    if policy.get("paused"):
        return False
    if policy["manual_active"]:
        return True
    if policy["mode"] == "automatic":
        return True
    if policy["mode"] == "manual":
        return False
    now = now or datetime.now(ZoneInfo(policy["timezone"]))
    local = now.astimezone(ZoneInfo(policy["timezone"]))
    hour, minute = map(int, policy["start_time"].split(":"))
    elapsed = (local.hour * 60 + local.minute - (hour * 60 + minute)) % 1440
    return elapsed < policy["window_hours"] * 60


@router.get("/api/v1/transcription-policy/{owner_user_id}")
def get_policy(owner_user_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    return database.get_transcription_policy(owner_id(owner_user_id))


@router.put("/api/v1/transcription-policy/{owner_user_id}")
def put_policy(owner_user_id: str, body: Policy, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    validate(body)
    return database.set_transcription_policy(owner_id(owner_user_id), body.mode,
                                             body.start_time, body.window_hours, body.timezone)


@router.post("/api/v1/transcription-policy/{owner_user_id}/run")
def run_now(owner_user_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    return database.set_manual_transcription(owner_id(owner_user_id), True)


@router.post("/api/v1/transcription-policy/{owner_user_id}/pause")
def pause(owner_user_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    return database.set_manual_transcription(owner_id(owner_user_id), False)


def claim_allowed_owners() -> list[str | None]:
    database.clear_idle_manual_transcription()
    owners = database.pending_job_owners()
    return [owner for owner in owners if owner is None or allowed(database.get_transcription_policy(owner))]

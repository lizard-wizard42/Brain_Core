import re
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Query

from services.memory.api.chunks import require_token, valid_owner

from services.memory.storage import database

router = APIRouter()

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _session_dict(row) -> dict:
    return {
        "id": row["id"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "device_id": row["device_id"],
        "status": database.compute_session_status(row["id"]),
        "text": database.get_session_text(row["id"]),
        "turns": database.compute_turns(row["id"]),
        "progress": database.get_job_progress(row["id"]),
    }


def _total_seconds(rows) -> int:
    total = 0
    for row in rows:
        if row["ended_at"]:
            total += int((_parse_iso(row["ended_at"]) - _parse_iso(row["started_at"])).total_seconds())
    return total


@router.get("/years")
def list_years(owner_user_id: str, authorization: str | None = Header(default=None)) -> list[int]:
    require_token(authorization)
    return database.distinct_years(valid_owner(owner_user_id))


@router.get("/years/{year}/months")
def list_months(year: int, owner_user_id: str, authorization: str | None = Header(default=None)) -> list[int]:
    require_token(authorization)
    return database.distinct_months(year, valid_owner(owner_user_id))


@router.get("/years/{year}/months/{month}/days")
def list_days(year: int, month: int, owner_user_id: str, authorization: str | None = Header(default=None)) -> list[str]:
    require_token(authorization)
    return database.distinct_days(year, month, valid_owner(owner_user_id))


@router.get("/days/{date}")
def get_day(date: str, owner_user_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token(authorization)
    owner = valid_owner(owner_user_id)
    if not _DATE_RE.match(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    rows = database.get_sessions_by_date(date, owner)
    return {
        "date": date,
        "total_seconds": _total_seconds(rows),
        "session_count": len(rows),
        "sessions": [_session_dict(row) for row in rows],
    }


@router.get("/sessions")
def list_sessions(
    owner_user_id: str,
    date: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_token(authorization)
    owner = valid_owner(owner_user_id)
    if date is not None:
        if not _DATE_RE.match(date):
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        rows = database.get_sessions_by_date(date, owner)
    else:
        rows = database.get_recent_sessions(50, owner)
    return [_session_dict(row) for row in rows]

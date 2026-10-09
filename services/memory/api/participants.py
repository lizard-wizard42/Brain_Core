"""Authenticated, account-scoped participant decisions and voice suggestions."""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.memory.api.chunks import require_token
from services.memory.storage import database, identities, voice_templates
from services.memory.worker.diarizer import AudioSampleLimitExceeded

router = APIRouter(prefix="/participants")


class IdentityInput(BaseModel):
    display_name: str


class VoiceLabelInput(BaseModel):
    identity_id: str | None = None


class DecisionInput(BaseModel):
    action: str
    identity_id: str | None = None


def _call(fn, *args):
    try:
        return fn(*args)
    except voice_templates.ParticipantProcessingBusy as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": "1"}) from exc
    except AudioSampleLimitExceeded as exc:
        raise HTTPException(status_code=413, detail="participant audio exceeds 300 seconds") from exc
    except ValueError as exc:
        message = str(exc)
        raise HTTPException(status_code=404 if "not found" in message else 400, detail=message) from exc


def _segment_in_session(owner_user_id: str, session_id: str, segment_id: int) -> None:
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM transcript_segments ts JOIN sessions s ON s.id=ts.session_id "
            "WHERE ts.id=? AND ts.session_id=? AND s.owner_user_id=?",
            (segment_id, session_id, owner_user_id),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="segment not found in session for account")


@router.get("/identities")
def list_identities(owner_user_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    return _call(identities.list_identities, owner_user_id)


@router.post("/identities", status_code=201)
def create_identity(body: IdentityInput, owner_user_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    return _call(identities.create_identity, owner_user_id, body.display_name)


@router.put("/sessions/{session_id}/voices/{voice_idx}")
def set_voice_label(session_id: str, voice_idx: int, body: VoiceLabelInput, owner_user_id: str,
                    authorization: str | None = Header(default=None)):
    require_token(authorization)
    if not database.session_owned_by(session_id, owner_user_id):
        raise HTTPException(status_code=404, detail="session not found")
    return _call(identities.set_voice_label, owner_user_id, session_id, voice_idx, body.identity_id)


@router.get("/segments/{segment_id}/decision")
def get_decision(segment_id: int, owner_user_id: str, session_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    _segment_in_session(owner_user_id, session_id, segment_id)
    return _call(identities.get_segment_decision, owner_user_id, segment_id)


@router.post("/segments/{segment_id}/decision")
def decide(segment_id: int, body: DecisionInput, owner_user_id: str, session_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    _segment_in_session(owner_user_id, session_id, segment_id)
    return _call(identities.decide_segment, owner_user_id, segment_id, body.identity_id, body.action)


@router.get("/segments/{segment_id}/suggestions")
def suggestions(segment_id: int, owner_user_id: str, session_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    _segment_in_session(owner_user_id, session_id, segment_id)
    decision = _call(identities.get_segment_decision, owner_user_id, segment_id)
    if decision and decision["action"] != "undo":
        return []
    return _call(voice_templates.suggest_segment, owner_user_id, segment_id)


@router.post("/segments/{segment_id}/template", status_code=201)
def create_template(segment_id: int, owner_user_id: str, session_id: str, authorization: str | None = Header(default=None)):
    require_token(authorization)
    _segment_in_session(owner_user_id, session_id, segment_id)
    return _call(voice_templates.create_template, owner_user_id, segment_id)

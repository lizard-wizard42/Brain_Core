from fastapi import APIRouter, Header, HTTPException

from services.memory.api.chunks import require_token, valid_owner

from services.memory.storage import database

router = APIRouter()


@router.get("/sessions/{session_id}/transcript")
def get_session_transcript(
    session_id: str, owner_user_id: str, authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)
    if not database.session_owned_by(session_id, valid_owner(owner_user_id)):
        raise HTTPException(status_code=404, detail="session not found")

    return {
        "session_id": session_id,
        "status": database.compute_session_status(session_id),
        "text": database.get_session_text(session_id),
        "turns": database.compute_turns(session_id),
        "progress": database.get_job_progress(session_id),
    }

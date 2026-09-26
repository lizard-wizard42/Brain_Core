from fastapi import APIRouter, Header, HTTPException

from services.memory.api.chunks import require_token, valid_owner

from services.memory.storage import database

router = APIRouter(prefix="/api/v1")


@router.get("/transcripts/{session_id}")
def get_transcript(
    session_id: str, owner_user_id: str, authorization: str | None = Header(default=None)
) -> dict:
    require_token(authorization)
    if not database.session_owned_by(session_id, valid_owner(owner_user_id)):
        raise HTTPException(status_code=404, detail="session not found")

    return {"session_id": session_id, "segments": database.get_segments(session_id)}

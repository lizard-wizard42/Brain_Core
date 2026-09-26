from fastapi import APIRouter, Header, Query

from services.memory.api.chunks import require_token, valid_owner

from services.memory.storage import database

router = APIRouter()


_SPEAKERS = {"me", "other", "unknown"}


@router.get("/search")
def search(
    owner_user_id: str,
    q: str = Query(...),
    limit: int = Query(default=20),
    speaker: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_token(authorization)
    owner = valid_owner(owner_user_id)
    query = q.strip()
    if len(query) < 2:
        return {"query": q, "results": []}

    limit = max(1, min(limit, 100))
    match_expr = '"' + query.replace('"', '""') + '"'
    speaker_filter = speaker if speaker in _SPEAKERS else None

    grouped: dict[str, dict] = {}
    order: list[str] = []
    for row in database.search_segments(match_expr, owner, speaker_filter):
        session_id = row["session_id"]
        if session_id not in grouped:
            if len(order) >= limit:
                continue
            grouped[session_id] = {
                "session_id": session_id,
                "date": row["started_at"][:10],
                "started_at": row["started_at"],
                "status": database.compute_session_status(session_id),
                "snippet": row["snippet"],
                "match_count": 1,
            }
            order.append(session_id)
        else:
            grouped[session_id]["match_count"] += 1

    return {"query": q, "results": [grouped[sid] for sid in order]}

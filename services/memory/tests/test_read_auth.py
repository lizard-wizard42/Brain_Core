"""Read endpoints require the bearer token and are scoped to the owner; fictional data only."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.memory.api.history import router as history_router
from services.memory.api.search import router as search_router
from services.memory.api.session_transcript import router as session_router
from services.memory.api.transcripts import router as transcripts_router
from services.memory.storage import database

OWNER_A = str(uuid.uuid4())
OWNER_B = str(uuid.uuid4())
AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "test-token")
    database.init_db()
    database.create_session_if_missing("sess-a", "dev-a", "2026-09-25T10:00:00Z", OWNER_A)
    database.create_session_if_missing("sess-b", "dev-b", "2026-09-25T11:00:00Z", OWNER_B)
    conn = database.get_connection()
    try:
        for session in ("sess-a", "sess-b"):
            conn.execute(
                "INSERT INTO transcript_segments (session_id, chunk_num, start_ms, end_ms, text, created_at) "
                "VALUES (?, 1, 0, 4000, 'fala ficticia zebra', 'now')", (session,),
            )
        conn.commit()
    finally:
        conn.close()
    app = FastAPI()
    for router in (history_router, search_router, session_router, transcripts_router):
        app.include_router(router)
    return TestClient(app)


def _urls(owner):
    return [
        f"/years?owner_user_id={owner}",
        f"/years/2026/months?owner_user_id={owner}",
        f"/years/2026/months/9/days?owner_user_id={owner}",
        f"/days/2026-09-25?owner_user_id={owner}",
        f"/sessions?owner_user_id={owner}",
        f"/search?q=zebra&owner_user_id={owner}",
        f"/sessions/sess-a/transcript?owner_user_id={owner}",
        f"/api/v1/transcripts/sess-a?owner_user_id={owner}",
    ]


def test_missing_or_wrong_token_is_rejected(client):
    for url in _urls(OWNER_A):
        assert client.get(url).status_code == 401, url
        assert client.get(url, headers={"Authorization": "Bearer nope"}).status_code == 401, url


def test_missing_or_invalid_owner_is_rejected(client):
    assert client.get("/sessions", headers=AUTH).status_code == 422
    assert client.get("/sessions?owner_user_id=x", headers=AUTH).status_code == 400


def test_other_owner_cannot_read_session(client):
    assert client.get(f"/sessions/sess-a/transcript?owner_user_id={OWNER_B}", headers=AUTH).status_code == 404
    assert client.get(f"/api/v1/transcripts/sess-a?owner_user_id={OWNER_B}", headers=AUTH).status_code == 404
    assert client.get(f"/sessions/sess-a/transcript?owner_user_id={OWNER_A}", headers=AUTH).status_code == 200


def test_listings_and_search_are_scoped_to_owner(client):
    ids = [s["id"] for s in client.get(f"/sessions?owner_user_id={OWNER_A}", headers=AUTH).json()]
    assert ids == ["sess-a"]
    day = client.get(f"/days/2026-09-25?owner_user_id={OWNER_B}", headers=AUTH).json()
    assert [s["id"] for s in day["sessions"]] == ["sess-b"]
    hits = client.get(f"/search?q=zebra&owner_user_id={OWNER_A}", headers=AUTH).json()["results"]
    assert [h["session_id"] for h in hits] == ["sess-a"]
    assert client.get(f"/years?owner_user_id={str(uuid.uuid4())}", headers=AUTH).json() == []

"""Completion cannot change another account's session, including legacy aliases."""
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.memory.api.chunks import router
from services.memory.storage import database

OWNER_A, OWNER_B = str(uuid.uuid4()), str(uuid.uuid4())
AUTH = {"Authorization": "Bearer synthetic-token"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "synthetic-token")
    database.init_db()
    for session, owner in (("victim", OWNER_A), ("own", OWNER_B), ("legacy", None)):
        database.create_session_if_missing(session, "synthetic-device", "2026-10-03T00:00:00Z", owner)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def state(session):
    with database.get_connection() as conn:
        return tuple(conn.execute("SELECT status, ended_at FROM sessions WHERE id = ?", (session,)).fetchone())


@pytest.mark.parametrize("prefix", ["/sessions", "/api/v1/sessions"])
def test_foreign_and_missing_owner_leave_session_intact(client, prefix):
    before = state("victim")
    for suffix in (f"?owner_user_id={OWNER_B}", ""):
        response = client.post(f"{prefix}/victim/complete{suffix}", headers=AUTH, json={"status": "stopped"})
        assert response.status_code == 404
        assert state("victim") == before


@pytest.mark.parametrize("prefix", ["/sessions", "/api/v1/sessions"])
def test_owner_and_null_legacy_complete_only_their_sessions(client, prefix):
    assert client.post(f"{prefix}/own/complete?owner_user_id={OWNER_B}", headers=AUTH,
                       json={"status": "failed"}).status_code == 200
    assert state("own")[0] == "failed" and state("own")[1]
    assert client.post(f"{prefix}/legacy/complete?owner_user_id={OWNER_A}", headers=AUTH,
                       json={"status": "stopped"}).status_code == 404
    assert client.post(f"{prefix}/legacy/complete", headers=AUTH,
                       json={"status": "stopped"}).status_code == 200
    assert state("legacy")[0] == "stopped"


def test_completion_auth_validation_and_atomic_database_boundary(client):
    url = f"/sessions/victim/complete?owner_user_id={OWNER_A}"
    assert client.post(url, json={"status": "stopped"}).status_code == 401
    assert client.post(url, headers=AUTH, json={"status": "recording"}).status_code == 400
    assert client.post("/sessions/victim/complete?owner_user_id=invalid", headers=AUTH,
                       json={"status": "stopped"}).status_code == 400
    before = state("victim")
    assert not database.complete_session("victim", "failed", OWNER_B)
    assert not database.complete_session("victim", "failed")
    assert state("victim") == before

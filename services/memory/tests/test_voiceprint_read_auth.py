"""Voiceprint status reads require authentication and respect the selected account."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.memory.api.voiceprint import router
from services.memory.storage import database


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "test-token")
    database.init_db()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_voiceprint_status_requires_token_and_scopes_account(client):
    owner = str(uuid.uuid4())
    other_owner = str(uuid.uuid4())
    database.set_voiceprint(b"\x00\x00\x80?", 1, 8.5, "synthetic-model", owner)
    url = f"/voiceprint?owner_user_id={owner}"

    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 401

    headers = {"Authorization": "Bearer test-token"}
    status = client.get(url, headers=headers)
    assert status.status_code == 200
    assert status.json()["enrolled"] is True
    assert status.json()["model"] == "synthetic-model"

    other = client.get(f"/voiceprint?owner_user_id={other_owner}", headers=headers)
    assert other.status_code == 200
    assert other.json()["enrolled"] is False
    assert other.json()["model"] is None
    assert client.get("/voiceprint?owner_user_id=invalid", headers=headers).status_code == 400

"""A chunk that stays empty after every attempt must not leave the session in error."""
import wave

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.memory.api.jobs import router
from services.memory.storage import database

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    monkeypatch.setenv("CELTWO_MEMORY_API_TOKEN", "test-token")
    database.init_db()
    database.create_session_if_missing("s1", "dev", "2026-01-01T00:00:00Z", "owner")
    wav = tmp_path / "chunk.wav"
    t = np.arange(32000) / 16000
    with wave.open(str(wav), "wb") as out:  # audible synthetic tone, no speech
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
        out.writeframes((0.3 * 32767 * np.sin(2 * np.pi * 220 * t)).astype("<i2").tobytes())
    conn = database.get_connection()
    try:
        conn.execute("INSERT INTO chunks (session_id, chunk_num, sha256, size_bytes, path, uploaded_at) "
                     "VALUES ('s1', 0, 'x', 1, ?, 'now')", (str(wav),))
        conn.commit()
    finally:
        conn.close()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _job(attempts):
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM jobs")
        cur = conn.execute("INSERT INTO jobs (session_id, chunk_num, status, attempts, created_at, updated_at, worker) "
                           "VALUES ('s1', 0, 'processing', ?, 'now', 'now', 'gpu')", (attempts,))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _status(job_id):
    return database.get_job(job_id)["status"]


@pytest.mark.parametrize("attempts,expected", [(0, "pending"), (1, "pending"), (2, "done")])
def test_empty_result_on_audible_audio_retries_then_is_accepted(client, attempts, expected):
    job_id = _job(attempts)
    r = client.post(f"/jobs/{job_id}/segments", headers=AUTH, json={"segments": [], "model": "m", "completed": True})
    assert r.status_code == 200
    assert _status(job_id) == expected


def test_incomplete_inference_still_fails_after_the_last_attempt(client):
    job_id = _job(2)
    client.post(f"/jobs/{job_id}/segments", headers=AUTH, json={"segments": [], "model": None, "completed": False})
    assert _status(job_id) == "failed"

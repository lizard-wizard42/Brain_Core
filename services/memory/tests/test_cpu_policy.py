"""CPU admission and atomic claims with fictional accounts and no ASR models."""
from datetime import datetime, timezone
import uuid
from services.memory.api import transcription_policy
from services.memory.storage import database
from services.memory.worker import worker


def test_cpu_obeys_each_account_policy_and_manual_run(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    database.init_db()
    owners = {key: str(uuid.uuid4()) for key in ("automatic", "manual", "paused", "scheduled")}
    sessions = {}
    for key, owner in owners.items():
        session = sessions[key] = str(uuid.uuid4())
        database.create_session_if_missing(session, "fictional", "2026-01-01T00:00:00Z", owner)
        database.insert_chunk(session, 1, "synthetic", 1, key)
        database.create_job_if_missing(session, 1)
    database.set_transcription_policy(owners["manual"], "manual", "22:00", 8, "UTC")
    database.set_manual_transcription(owners["paused"], False)
    database.set_transcription_policy(owners["scheduled"], "scheduled", "22:00", 2, "UTC")
    original = transcription_policy.allowed
    monkeypatch.setattr(transcription_policy, "allowed", lambda p: original(p, datetime(2026, 1, 1, 12, tzinfo=timezone.utc)))
    seen = []
    monkeypatch.setattr(worker, "transcribe_chunk", lambda path: seen.append(path) or [])
    monkeypatch.setattr(worker, "label_chunk", lambda *a: None)
    assert worker.process_one_job()
    assert not worker.process_one_job()
    assert seen == ["automatic"]
    for key in ("manual", "paused", "scheduled"):
        assert database.get_job_statuses(sessions[key]) == ["pending"]
    database.set_manual_transcription(owners["manual"], True)
    assert worker.process_one_job()
    assert not worker.process_one_job()
    assert seen == ["automatic", "manual"]
    assert database.get_transcription_policy(owners["manual"])["manual_active"] == 0


def test_claimed_cpu_job_cannot_be_claimed_by_gpu(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    database.init_db()
    owner, session = str(uuid.uuid4()), str(uuid.uuid4())
    database.create_session_if_missing(session, "fictional", "2026-01-01T00:00:00Z", owner)
    database.insert_chunk(session, 1, "synthetic", 1, "fictional.audio")
    database.create_job_if_missing(session, 1)
    first = database.claim_next_job("cpu", [owner])
    assert first and database.get_job(first["id"])["status"] == "processing"
    assert database.claim_next_job("gpu", [owner]) is None

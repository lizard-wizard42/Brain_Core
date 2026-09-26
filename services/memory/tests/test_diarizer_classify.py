"""Synthetic characterisation of the legacy me/other/unknown classifier (no real audio)."""
import numpy as np

from services.memory.worker import diarizer
from services.memory.storage import database


def test_ambiguity_gap_stays_unknown():
    sims = np.array([0.36, 0.37])
    assert diarizer._classify(sims) == ["unknown", "unknown"]


def test_bands_and_smoothing_only_fill_between_agreeing_neighbours():
    assert diarizer._classify(np.array([0.7, 0.36, 0.7])) == ["me", "me", "me"]
    assert diarizer._classify(np.array([0.7, 0.36, 0.1])) == ["me", "unknown", "other"]


def test_label_is_only_the_owner_binary_never_a_named_identity():
    labels = set(diarizer._classify(np.linspace(-1, 1, 41)))
    assert labels <= {"me", "other", "unknown"}


def test_new_processing_never_assigns_owner_from_raw_similarity(monkeypatch):
    class Storage:
        def get_session_owner(self, session_id): return "account-a"
        def get_voiceprint(self, owner): return {"updated_at": "synthetic"}
        def get_segments_for_chunk(self, session_id, chunk_num): return [{"id": 1}, {"id": 2}]
        def set_chunk_speakers_if_voiceprint_current(self, session_id, chunk_num, updated_at, result):
            assert result == {1: "unknown", 2: "unknown"}
            return True

    monkeypatch.setattr(diarizer, "database", Storage())
    assert diarizer.label_chunk("synthetic-session", 1) == {1: "unknown", 2: "unknown"}


def test_upgrade_clears_only_legacy_automatic_labels(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    database.init_db()
    database.create_session_if_missing("synthetic", "device-a", "2026-01-01T00:00:00Z", "account-a")
    conn = database.get_connection()
    try:
        for speaker in ("me", "other", "unknown"):
            conn.execute("INSERT INTO transcript_segments "
                         "(session_id, chunk_num, start_ms, end_ms, text, speaker, created_at) "
                         "VALUES ('synthetic', 1, 0, 1000, 'synthetic', ?, 'now')", (speaker,))
        conn.execute("UPDATE schema_version SET version=11 WHERE id=1")
        conn.commit()
    finally:
        conn.close()
    database.init_db()
    conn = database.get_connection()
    try:
        speakers = [row[0] for row in conn.execute("SELECT speaker FROM transcript_segments ORDER BY id")]
        assert speakers == [None, None, "unknown"]
    finally:
        conn.close()

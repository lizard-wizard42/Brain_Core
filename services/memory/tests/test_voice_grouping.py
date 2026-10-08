"""Synthetic, offline checks of session voice grouping (no real audio or model)."""
import numpy as np
import pytest

from services.memory.storage import database
from services.memory.worker import voices


class ToneEmbedder:
    name = "tone-v1"

    def embed(self, pcm):
        spectrum = np.abs(np.fft.rfft(pcm))
        freqs = np.fft.rfftfreq(pcm.size, 1 / 16000)
        return np.array([spectrum[(freqs > lo) & (freqs < hi)].sum()
                         for lo, hi in ((100, 300), (300, 600), (600, 1000))], dtype=np.float32)


def tone(freq, seconds):
    t = np.arange(int(16000 * seconds)) / 16000
    return (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    (tmp_path / "chunk.m4a").write_bytes(b"x")
    database.init_db()
    database.create_session_if_missing("s1", "test", "2026-01-01T00:00:00Z", "owner")
    # me x3 (+1 s short), other x3, me, then a one-off third voice; contiguous, so the short one has agreeing neighbours.
    parts = [(180, 3), (180, 1), (180, 3), (750, 3), (750, 3), (750, 3), (180, 3), (450, 3)]
    pcm = np.concatenate([tone(f, s) for f, s in parts])
    conn = database.get_connection()
    try:
        conn.execute("INSERT INTO chunks (session_id, chunk_num, sha256, size_bytes, path, uploaded_at) "
                     "VALUES ('s1', 0, 'x', 1, ?, 'now')", (str(tmp_path / "chunk.m4a"),))
        start = 0
        for _, seconds in parts:
            conn.execute("INSERT INTO transcript_segments (session_id, chunk_num, start_ms, end_ms, text, created_at) "
                         "VALUES ('s1', 0, ?, ?, 'texto', 'now')", (start, start + int(seconds * 1000)))
            start += int(seconds * 1000)
        conn.commit()
    finally:
        conn.close()
    monkeypatch.setattr(voices, "decode_pcm_16k_mono", lambda path, **kw: pcm)
    return tmp_path


def test_groups_same_voice_together_and_new_voice_apart(session):
    result = voices.assign_voices("s1", 0, ToneEmbedder())
    segs = database.get_segments_for_chunk("s1", 0)
    groups = [s["voice_idx"] for s in segs]
    assert groups == [0, 0, 0, 1, 1, 1, 0, 2]
    assert len(result) == 8  # the 1 s segment inherits from agreeing neighbours


def test_is_idempotent_per_chunk(session):
    voices.assign_voices("s1", 0, ToneEmbedder())
    assert voices.assign_voices("s1", 0, ToneEmbedder()) == {}
    assert database.get_session_voices("s1", "tone-v1")[0]["n"] == 3


def test_can_be_disabled(session, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_VOICE_GROUPING", "0")
    assert voices.assign_voices("s1", 0, ToneEmbedder()) == {}
    assert all(s["voice_idx"] is None for s in database.get_segments_for_chunk("s1", 0))


def _enroll(frequency):
    vec = ToneEmbedder().embed(tone(frequency, 3))
    conn = database.get_connection()
    try:
        conn.execute("INSERT INTO account_voiceprints (owner_user_id, embedding, dim, sample_seconds, model, updated_at) "
                     "VALUES ('owner', ?, 3, 3, 'tone-v1', 'now')", (vec.tobytes(),))
        conn.commit()
    finally:
        conn.close()


def test_probable_me_only_with_enrolled_voice_and_clear_margin(session):
    voices.assign_voices("s1", 0, ToneEmbedder())
    assert voices.me_probable_voice("s1") is None  # nothing enrolled
    _enroll(180)
    assert voices.me_probable_voice("s1") == 0
    turns = database.compute_turns("s1")
    assert [t.get("voice") for t in turns] == ["speaker_0"] * 3 + ["speaker_1"] * 3 + ["speaker_0", None]
    assert [t.get("voice_is_me_probable") for t in turns] == [True] * 3 + [False] * 3 + [True, None]
    assert all(t["speaker"] is None for t in turns)  # grouping never writes the legacy speaker


def test_enrolled_voice_matching_nobody_marks_nobody(session):
    voices.assign_voices("s1", 0, ToneEmbedder())
    _enroll(450)
    assert voices.me_probable_voice("s1") is None


def test_one_off_voice_is_not_reported_as_a_speaker(session):
    voices.assign_voices("s1", 0, ToneEmbedder())
    assert set(voices.active_voices("s1", "tone-v1")) == {0, 1}

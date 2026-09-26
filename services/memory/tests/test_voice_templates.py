"""Synthetic, offline checks of extraction gates and suggestion isolation."""

import numpy as np
import pytest

from services.memory.storage import database, identities, voice_templates


class SyntheticEmbedder:
    name = "synthetic-v1"

    def embed(self, pcm):
        spectrum = np.abs(np.fft.rfft(pcm))
        frequencies = np.fft.rfftfreq(pcm.size, 1 / 16000)
        return np.array([spectrum[(frequencies > lo) & (frequencies < hi)].sum()
                         for lo, hi in ((100, 300), (300, 600), (600, 1000))], dtype=np.float32)


@pytest.fixture
def samples(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    database.init_db()
    clips = {}
    for account, session, frequency in (("a", "sa", 180), ("a", "sb", 180),
                                        ("a", "sc", 750), ("b", "sd", 180)):
        database.create_session_if_missing(session, "test", "2026-01-01T00:00:00Z", account)
        t = np.arange(64000) / 16000
        clips[session] = (0.3 * np.sin(2 * np.pi * frequency * t)).astype(np.float32)
        conn = database.get_connection()
        try:
            conn.execute("INSERT INTO chunks (session_id, chunk_num, sha256, size_bytes, path, uploaded_at) "
                         "VALUES (?, 1, 'synthetic', 1, ?, 'now')", (session, session))
            conn.execute("INSERT INTO transcript_segments "
                         "(session_id, chunk_num, start_ms, end_ms, text, created_at) "
                         "VALUES (?, 1, 0, 4000, 'synthetic', 'now')", (session,))
            conn.commit()
        finally:
            conn.close()
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path: clips[path])
    return {session: database.get_segments(session)[0]["id"] for session in clips}


def test_confirmed_source_and_account_model_isolation(samples):
    ana = identities.create_identity("a", "Ana")
    ids = samples
    encoder = SyntheticEmbedder()
    with pytest.raises(ValueError, match="confirmation"):
        voice_templates.create_template("a", ids["sa"], encoder)
    identities.decide_segment("a", ids["sa"], ana["id"], "confirm")
    template = voice_templates.create_template("a", ids["sa"], encoder)
    positive = voice_templates.suggest_segment("a", ids["sb"], encoder)[0]
    negative = voice_templates.suggest_segment("a", ids["sc"], encoder)[0]
    assert positive["identity_id"] == ana["id"]
    # Exploratory synthetic operating point only; no production threshold.
    assert sum(score >= 0.7 for score in [negative["similarity"]]) == 0  # 0/1 false positives
    assert sum(score < 0.7 for score in [positive["similarity"]]) == 0  # 0/1 false negatives
    assert voice_templates.suggest_segment("b", ids["sd"], encoder) == []
    other_model = SyntheticEmbedder()
    other_model.name = "synthetic-v2"
    assert voice_templates.suggest_segment("a", ids["sb"], other_model) == []
    assert identities.get_segment_decision("a", ids["sb"]) is None
    assert voice_templates.delete_template("a", template["id"])
    assert voice_templates.suggest_segment("a", ids["sb"], encoder) == []
    refreshed = voice_templates.create_template("a", ids["sa"], encoder)
    identities.decide_segment("a", ids["sa"], None, "undo")
    assert voice_templates.suggest_segment("a", ids["sb"], encoder) == []
    assert not voice_templates.delete_template("b", refreshed["id"])


def test_duration_quality_and_overlap(samples, monkeypatch):
    ana = identities.create_identity("a", "Ana")
    sid = samples["sa"]
    identities.decide_segment("a", sid, ana["id"], "confirm")
    conn = database.get_connection()
    try:
        conn.execute("UPDATE transcript_segments SET end_ms=2000 WHERE id=?", (sid,))
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(ValueError, match="too short"):
        voice_templates.create_template("a", sid, SyntheticEmbedder())
    conn = database.get_connection()
    try:
        conn.execute("UPDATE transcript_segments SET end_ms=4000 WHERE id=?", (sid,))
        conn.execute("INSERT INTO transcript_segments "
                     "(session_id, chunk_num, start_ms, end_ms, text, created_at) "
                     "VALUES ('sa', 1, 1000, 2000, 'overlap', 'now')")
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(ValueError, match="overlaps"):
        voice_templates.create_template("a", sid, SyntheticEmbedder())
    conn = database.get_connection()
    try:
        conn.execute("DELETE FROM transcript_segments WHERE session_id='sa' AND id!=?", (sid,))
        conn.commit()
    finally:
        conn.close()
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path: np.zeros(64000, dtype=np.float32))
    with pytest.raises(ValueError, match="quality"):
        voice_templates.create_template("a", sid, SyntheticEmbedder())


def test_unknown_noisy_and_two_speaker_samples_never_assign_identity(samples, monkeypatch):
    ana = identities.create_identity("a", "Ana")
    identities.decide_segment("a", samples["sa"], ana["id"], "confirm")
    voice_templates.create_template("a", samples["sa"], SyntheticEmbedder())

    rng = np.random.default_rng(47)
    noise = rng.normal(0, 0.2, 64000).astype(np.float32)
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path: noise)
    # A noisy unknown voice may receive suggestions, but cannot create a decision.
    voice_templates.suggest_segment("a", samples["sc"], SyntheticEmbedder())
    assert identities.get_segment_decision("a", samples["sc"]) is None

    # A segment crossing another speaker interval cannot serve as a template.
    conn = database.get_connection()
    try:
        conn.execute("INSERT INTO transcript_segments "
                     "(session_id, chunk_num, start_ms, end_ms, text, created_at) "
                     "VALUES ('sb', 1, 1000, 3000, 'second speaker', 'now')")
        conn.commit()
    finally:
        conn.close()
    identities.decide_segment("a", samples["sb"], ana["id"], "confirm")
    with pytest.raises(ValueError, match="overlaps"):
        voice_templates.create_template("a", samples["sb"], SyntheticEmbedder())

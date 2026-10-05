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
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path, **kwargs: clips[path])
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
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path, **kwargs: np.zeros(64000, dtype=np.float32))
    with pytest.raises(ValueError, match="quality"):
        voice_templates.create_template("a", sid, SyntheticEmbedder())


def test_unknown_noisy_and_two_speaker_samples_never_assign_identity(samples, monkeypatch):
    ana = identities.create_identity("a", "Ana")
    identities.decide_segment("a", samples["sa"], ana["id"], "confirm")
    voice_templates.create_template("a", samples["sa"], SyntheticEmbedder())

    rng = np.random.default_rng(47)
    noise = rng.normal(0, 0.2, 64000).astype(np.float32)
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda path, **kwargs: noise)
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


def test_decode_budget_and_no_inference_writer_lock(samples, monkeypatch):
    ana = identities.create_identity("a", "Ana")
    identities.decide_segment("a", samples["sa"], ana["id"], "confirm")
    def decode(path, *, max_samples):
        assert max_samples == 300 * 16000
        return (0.3 * np.sin(2 * np.pi * 180 * np.arange(64000) / 16000)).astype(np.float32)
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", decode)
    class Encoder(SyntheticEmbedder):
        def embed(self, pcm):
            # A second connection must be able to write while inference runs.
            identities.create_identity("b", "Independent writer")
            return super().embed(pcm)
    assert voice_templates.create_template("a", samples["sa"], Encoder())["identity_id"] == ana["id"]
    assert len(identities.list_identities("b")) == 1


def test_changed_manual_confirmation_during_inference_aborts_commit(samples):
    ana = identities.create_identity("a", "Ana")
    identities.decide_segment("a", samples["sa"], ana["id"], "confirm")
    class Encoder(SyntheticEmbedder):
        def embed(self, pcm):
            identities.decide_segment("a", samples["sa"], None, "undo")
            return super().embed(pcm)
    with pytest.raises(ValueError, match="confirmation"):
        voice_templates.create_template("a", samples["sa"], Encoder())
    conn = database.get_connection()
    try:
        assert conn.execute("SELECT COUNT(*) FROM voice_templates").fetchone()[0] == 0
    finally:
        conn.close()


def test_participant_resource_limits_reach_api_before_embedding(samples, tmp_path, monkeypatch):
    from fastapi import HTTPException
    from services.memory.api.participants import _call
    from services.memory.tests.test_voiceprint_limits import flac
    database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, "synthetic-v1", "a")
    path = tmp_path / "long-synthetic.flac"
    path.write_bytes(flac(301))
    from services.memory.worker.diarizer import decode_pcm_16k_mono
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", lambda _, **kw: decode_pcm_16k_mono(str(path), **kw))
    with pytest.raises(HTTPException) as too_long:
        _call(voice_templates.suggest_segment, "a", samples["sa"], SyntheticEmbedder())
    assert too_long.value.status_code == 413
    assert voice_templates._processing.acquire(blocking=False)
    try:
        with pytest.raises(HTTPException) as busy:
            _call(voice_templates.suggest_segment, "a", samples["sa"], SyntheticEmbedder())
        assert busy.value.status_code == 429
        assert busy.value.headers["Retry-After"] == "1"
    finally:
        voice_templates._processing.release()


def test_enrolled_voice_suggests_only_own_identity_and_requires_confirmation(samples):
    encoder = SyntheticEmbedder()
    t = np.arange(64000) / 16000
    vector = encoder.embed((0.3 * np.sin(2 * np.pi * 180 * t)).astype(np.float32))
    database.set_voiceprint(vector.tobytes(), vector.size, 30, encoder.name, "a")
    own = identities.list_identities("a")[0]
    assert own == {"id": identities.owner_identity_id("a"), "display_name": "Minha voz", "is_owner": True}
    assert identities.list_identities("b") == []
    suggestion = voice_templates.suggest_segment("a", samples["sa"], encoder)[0]
    assert suggestion["identity_id"] == own["id"]
    assert suggestion["similarity"] > 0.99
    assert suggestion["template_id"] is None
    assert identities.get_segment_decision("a", samples["sa"]) is None
    assert voice_templates.suggest_segment("b", samples["sd"], encoder) == []
    with pytest.raises(ValueError, match="identity not found"):
        identities.decide_segment("b", samples["sd"], own["id"], "confirm")
    identities.decide_segment("a", samples["sa"], own["id"], "confirm")
    assert identities.get_segment_decision("a", samples["sa"])["identity_id"] == own["id"]
    assert voice_templates.create_template("a", samples["sa"], encoder)["identity_id"] == own["id"]


def test_ineligible_and_empty_reference_reads_skip_inference_even_when_busy(samples, monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("read must not load model or decode audio")
    monkeypatch.setattr(voice_templates, "_local_embedder", unexpected)
    monkeypatch.setattr(voice_templates, "decode_pcm_16k_mono", unexpected)
    voice_templates._processing.acquire()
    try:
        assert voice_templates.suggest_segment("a", samples["sa"]) == []
        database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, "synthetic-v1", "a")
        conn = database.get_connection()
        conn.execute("UPDATE transcript_segments SET end_ms=1880 WHERE id=?", (samples["sa"],))
        conn.commit(); conn.close()
        assert voice_templates.suggest_segment("a", samples["sa"], SyntheticEmbedder()) == []
        with pytest.raises(ValueError, match="unavailable for account"):
            voice_templates.suggest_segment("b", samples["sa"])
    finally:
        voice_templates._processing.release()


def test_voice_reference_revoked_or_changed_during_inference_is_not_suggested(samples):
    encoder = SyntheticEmbedder()
    for action in ("delete", "replace"):
        database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, encoder.name, "a")
        class ChangedEncoder(SyntheticEmbedder):
            def embed(self, pcm):
                if action == "delete":
                    database.clear_voiceprint("a")
                else:
                    database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, encoder.name, "a")
                return super().embed(pcm)
        assert voice_templates.suggest_segment("a", samples["sa"], ChangedEncoder()) == []
    database.clear_voiceprint("a")
    assert identities.list_identities("a") == []


def test_virtual_owner_does_not_collide_with_existing_participant_name(samples):
    named = identities.create_identity("a", "Minha voz")
    database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, "synthetic-v1", "a")
    own = identities.owner_identity_id("a")
    identities.decide_segment("a", samples["sa"], own, "confirm")
    assert own != named["id"]
    assert identities.get_segment_decision("a", samples["sa"])["identity_id"] == own


def test_manual_reference_undone_during_comparison_is_discarded(samples):
    ana = identities.create_identity("a", "Synthetic participant")
    identities.decide_segment("a", samples["sa"], ana["id"], "confirm")
    voice_templates.create_template("a", samples["sa"], SyntheticEmbedder())
    class ChangedEncoder(SyntheticEmbedder):
        def embed(self, pcm):
            identities.decide_segment("a", samples["sa"], None, "undo")
            return super().embed(pcm)
    assert voice_templates.suggest_segment("a", samples["sb"], ChangedEncoder()) == []


def test_owner_flag_uses_identity_not_display_name_and_follows_undo(samples):
    database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, "synthetic-v1", "a")
    named_like_owner = identities.create_identity("a", "Minha voz")
    other = identities.decide_segment("a", samples["sa"], named_like_owner["id"], "correct")
    assert other["is_owner"] is False
    assert identities.get_segment_decision("a", samples["sa"])["is_owner"] is False
    own = identities.decide_segment("a", samples["sa"], identities.owner_identity_id("a"), "confirm")
    assert own["is_owner"] is True
    assert identities.get_segment_decision("a", samples["sa"])["is_owner"] is True
    assert identities.decide_segment("a", samples["sa"], None, "undo")["is_owner"] is False
    assert identities.get_segment_decision("a", samples["sa"])["is_owner"] is False


def test_identity_list_marks_owner_without_renaming_other_participants(samples):
    database.set_voiceprint(np.ones(3, dtype=np.float32).tobytes(), 3, 30, "synthetic-v1", "a")
    other = identities.create_identity("a", "Minha voz")
    listed = {item["id"]: item for item in identities.list_identities("a")}
    assert listed[identities.owner_identity_id("a")]["is_owner"] is True
    assert listed[other["id"]]["is_owner"] is False
    assert listed[other["id"]]["display_name"] == "Minha voz"

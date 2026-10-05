"""Hermetic account and manual-decision checks; no real audio or transcript."""

import pytest

from services.memory.storage import database, identities
from services.memory.storage.models import CURRENT_SCHEMA_VERSION


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setenv("CELTWO_MEMORY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CELTWO_MEMORY_DB_PATH", str(tmp_path / "memory.db"))
    database.init_db()
    database.create_session_if_missing("fiction-a", "device-a", "2026-09-25T00:00:00Z", "account-a")
    database.create_session_if_missing("fiction-b", "device-b", "2026-09-25T00:00:00Z", "account-b")
    conn = database.get_connection()
    try:
        for session in ("fiction-a", "fiction-b"):
            conn.execute(
                "INSERT INTO transcript_segments "
                "(session_id, chunk_num, start_ms, end_ms, text, created_at) "
                "VALUES (?, 1, 0, 4000, 'fala fictícia', 'now')", (session,),
            )
        conn.commit()
    finally:
        conn.close()


def _segment_id(session):
    return database.get_segments(session)[0]["id"]


def test_reuses_name_within_account_but_not_across_accounts():
    first = identities.create_identity("account-a", "Ana")
    assert identities.create_identity("account-a", "ana")["id"] == first["id"]
    assert identities.create_identity("account-b", "Ana")["id"] != first["id"]
    assert identities.list_identities("account-a") == [{**first, "is_owner": False}]


def test_schema_upgrade_is_additive_and_idempotent():
    a = _segment_id("fiction-a")
    database.init_db()
    assert _segment_id("fiction-a") == a
    conn = database.get_connection()
    try:
        assert conn.execute("SELECT version FROM schema_version WHERE id = 1").fetchone()[0] == CURRENT_SCHEMA_VERSION
        assert conn.execute("SELECT count(*) FROM transcript_segments").fetchone()[0] == 2
    finally:
        conn.close()


def test_decision_is_scoped_and_reversible_without_renaming_other_segments():
    ana = identities.create_identity("account-a", "Ana")
    bia = identities.create_identity("account-a", "Bia")
    a = _segment_id("fiction-a")
    b = _segment_id("fiction-b")
    identities.decide_segment("account-a", a, ana["id"], "confirm")
    assert identities.get_segment_decision("account-a", a)["display_name"] == "Ana"
    with pytest.raises(ValueError, match="segment not found"):
        identities.decide_segment("account-a", b, ana["id"], "confirm")
    with pytest.raises(ValueError, match="identity not found"):
        identities.decide_segment("account-b", b, ana["id"], "confirm")
    identities.decide_segment("account-a", a, bia["id"], "correct")
    assert identities.get_segment_decision("account-a", a)["display_name"] == "Bia"
    identities.decide_segment("account-a", a, None, "undo")
    assert identities.get_segment_decision("account-a", a)["identity_id"] is None
    assert [item["display_name"] for item in identities.list_identities("account-a")] == ["Ana", "Bia"]


def test_delete_removes_templates_and_hides_old_decisions():
    ana = identities.create_identity("account-a", "Ana")
    a = _segment_id("fiction-a")
    identities.decide_segment("account-a", a, ana["id"], "confirm")
    conn = database.get_connection()
    try:
        conn.execute(
            "INSERT INTO voice_templates "
            "(id, owner_user_id, identity_id, embedding, model, dim, sample_seconds, "
            "source_segment_id, source_session_id, source_chunk_num, created_at) "
            "VALUES ('template-a', 'account-a', ?, X'0102', 'synthetic', 2, 4, ?, 'fiction-a', 1, 'now')",
            (ana["id"], a),
        )
        conn.commit()
    finally:
        conn.close()
    assert identities.delete_identity("account-a", ana["id"])
    assert identities.get_segment_decision("account-a", a)["identity_id"] is None
    conn = database.get_connection()
    try:
        assert conn.execute("SELECT count(*) FROM voice_templates").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM segment_identity_decisions").fetchone()[0] == 1
    finally:
        conn.close()


def test_upgrade_from_legacy_schema_preserves_text_and_manual_decisions():
    segment = _segment_id("fiction-a")
    identity = identities.create_identity("account-a", "Ana")
    identities.decide_segment("account-a", segment, identity["id"], "confirm")
    conn = database.get_connection()
    try:
        conn.execute("UPDATE schema_version SET version = 10 WHERE id = 1")
        conn.execute("UPDATE transcript_segments SET speaker = 'me' WHERE id = ?", (segment,))
        conn.commit()
    finally:
        conn.close()
    database.init_db()
    database.init_db()
    assert identities.get_segment_decision("account-a", segment)["identity_id"] == identity["id"]
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT text, speaker FROM transcript_segments WHERE id = ?", (segment,)).fetchone()
        assert row["text"] == "fala fictícia"
        assert row["speaker"] is None
        assert conn.execute("SELECT count(*) FROM sessions").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM transcript_segments").fetchone()[0] == 2
    finally:
        conn.close()

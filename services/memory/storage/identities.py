"""Account-scoped manual participant identity decisions.

No recognition score is treated as a probability and no automatic assignment
is made here. Legacy `speaker` and the owner's `Minha voz` stay independent.
"""

import sqlite3
import uuid

from services.memory.storage.database import _now_iso, get_connection


def _owner(value: str) -> str:
    if not value or not value.strip():
        raise ValueError("owner_user_id is required")
    return value


def _segment(conn: sqlite3.Connection, owner_user_id: str, segment_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT ts.id, ts.session_id, ts.chunk_num, ts.start_ms, ts.end_ms "
        "FROM transcript_segments ts JOIN sessions s ON s.id = ts.session_id "
        "WHERE ts.id = ? AND s.owner_user_id = ?",
        (segment_id, owner_user_id),
    ).fetchone()
    if row is None:
        raise ValueError("segment not found for account")
    return row


def create_identity(owner_user_id: str, display_name: str) -> dict:
    owner_user_id = _owner(owner_user_id)
    name = display_name.strip()
    if not name or len(name) > 40:
        raise ValueError("display_name must have 1 to 40 characters")
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id, display_name FROM voice_identities "
            "WHERE owner_user_id = ? AND lower(display_name) = lower(?) AND deleted_at IS NULL",
            (owner_user_id, name),
        ).fetchone()
        if existing:
            return dict(existing)
        identity_id = str(uuid.uuid4())
        try:
            conn.execute(
                "INSERT INTO voice_identities(id, owner_user_id, display_name, created_at) "
                "VALUES (?, ?, ?, ?)", (identity_id, owner_user_id, name, _now_iso()),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Another request may have inserted this name concurrently.
            existing = conn.execute(
                "SELECT id, display_name FROM voice_identities "
                "WHERE owner_user_id = ? AND lower(display_name) = lower(?) AND deleted_at IS NULL",
                (owner_user_id, name),
            ).fetchone()
            if existing:
                return dict(existing)
            raise
        return {"id": identity_id, "display_name": name}
    finally:
        conn.close()


def list_identities(owner_user_id: str) -> list[dict]:
    conn = get_connection()
    try:
        return [dict(row) for row in conn.execute(
            "SELECT id, display_name FROM voice_identities "
            "WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY display_name",
            (_owner(owner_user_id),),
        )]
    finally:
        conn.close()


def decide_segment(owner_user_id: str, segment_id: int,
                   identity_id: str | None, action: str) -> dict:
    owner_user_id = _owner(owner_user_id)
    if action not in {"confirm", "correct", "ignore", "undo"}:
        raise ValueError("invalid decision action")
    if action in {"confirm", "correct"} and identity_id is None:
        raise ValueError("identity_id is required")
    if action in {"ignore", "undo"} and identity_id is not None:
        raise ValueError("identity_id must be empty")
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        _segment(conn, owner_user_id, segment_id)
        if identity_id is not None:
            found = conn.execute(
                "SELECT 1 FROM voice_identities WHERE id = ? AND owner_user_id = ? "
                "AND deleted_at IS NULL", (identity_id, owner_user_id),
            ).fetchone()
            if not found:
                raise ValueError("identity not found for account")
        now = _now_iso()
        conn.execute(
            "INSERT INTO segment_identity_decisions "
            "(owner_user_id, segment_id, identity_id, action, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (owner_user_id, segment_id, identity_id, action, now),
        )
        # A later manual choice invalidates embeddings attributed to the old
        # identity. A fresh extraction must use the current confirmation.
        conn.execute(
            "UPDATE voice_templates SET deleted_at = ? WHERE owner_user_id = ? "
            "AND source_segment_id = ? AND deleted_at IS NULL",
            (now, owner_user_id, segment_id),
        )
        conn.commit()
        return {"segment_id": segment_id, "identity_id": identity_id,
                "action": action, "created_at": now}
    finally:
        conn.close()


def get_segment_decision(owner_user_id: str, segment_id: int) -> dict | None:
    conn = get_connection()
    try:
        _segment(conn, _owner(owner_user_id), segment_id)
        row = conn.execute(
            "SELECT d.identity_id, d.action, d.created_at, i.display_name "
            "FROM segment_identity_decisions d "
            "LEFT JOIN voice_identities i ON i.id = d.identity_id "
            "AND i.owner_user_id = d.owner_user_id AND i.deleted_at IS NULL "
            "WHERE d.owner_user_id = ? AND d.segment_id = ? "
            "ORDER BY d.id DESC LIMIT 1", (owner_user_id, segment_id),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        if result["identity_id"] is not None and result["display_name"] is None:
            result["identity_id"] = None
            result["action"] = "undo"
        return result
    finally:
        conn.close()


def delete_identity(owner_user_id: str, identity_id: str) -> bool:
    owner_user_id = _owner(owner_user_id)
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = _now_iso()
        changed = conn.execute(
            "UPDATE voice_identities SET deleted_at = ? "
            "WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL",
            (now, identity_id, owner_user_id),
        ).rowcount
        if changed:
            # Preserve the history. A deleted identity becomes ineffective,
            # including old confirmations, without rewriting their records.
            conn.execute(
                "DELETE FROM voice_templates WHERE identity_id = ? AND owner_user_id = ?",
                (identity_id, owner_user_id),
            )
        conn.commit()
        return bool(changed)
    finally:
        conn.close()

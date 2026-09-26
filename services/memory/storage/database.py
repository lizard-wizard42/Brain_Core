import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.memory.storage.models import CURRENT_SCHEMA_VERSION


def get_data_dir() -> Path:
    data_dir = Path(os.environ.get("CELTWO_MEMORY_DATA_DIR", "data/memory"))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_db_path() -> Path:
    default_path = str(get_data_dir() / "memory.db")
    return Path(os.environ.get("CELTWO_MEMORY_DB_PATH", default_path))


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def get_audio_retention(owner_user_id: str) -> dict:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT automatic, days FROM audio_retention WHERE owner_user_id = ?",
            (owner_user_id,),
        ).fetchone()
        return {"automatic": bool(row["automatic"]), "days": row["days"]} if row else {"automatic": False, "days": 90}
    finally:
        conn.close()


def set_audio_retention(owner_user_id: str, automatic: bool, days: int) -> dict:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO audio_retention(owner_user_id, automatic, days) VALUES(?, ?, ?) "
            "ON CONFLICT(owner_user_id) DO UPDATE SET automatic=excluded.automatic, days=excluded.days",
            (owner_user_id, int(automatic), days),
        )
        conn.commit()
    finally:
        conn.close()
    return {"automatic": automatic, "days": days}


def automatic_audio_retention_policies() -> list[dict]:
    conn = get_connection()
    try:
        return [dict(row) for row in conn.execute(
            "SELECT owner_user_id, days FROM audio_retention WHERE automatic = 1"
        )]
    finally:
        conn.close()


def get_transcription_policy(owner_user_id: str) -> dict:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT mode, start_time, window_hours, timezone, manual_active, paused "
            "FROM transcription_policy WHERE owner_user_id = ?", (owner_user_id,)
        ).fetchone()
        return dict(row) if row else {"mode": "automatic", "start_time": "22:00",
                                      "window_hours": 8, "timezone": "America/Sao_Paulo", "manual_active": 0, "paused": 0}
    finally:
        conn.close()


def set_transcription_policy(owner_user_id: str, mode: str, start_time: str,
                             window_hours: int, timezone: str) -> dict:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO transcription_policy(owner_user_id, mode, start_time, window_hours, timezone, manual_active) "
            "VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(owner_user_id) DO UPDATE SET "
            "mode=excluded.mode, start_time=excluded.start_time, "
            "window_hours=excluded.window_hours, timezone=excluded.timezone, manual_active=0, paused=0",
            (owner_user_id, mode, start_time, window_hours, timezone),
        )
        conn.commit()
    finally:
        conn.close()
    return get_transcription_policy(owner_user_id)


def set_manual_transcription(owner_user_id: str, active: bool) -> dict:
    policy = get_transcription_policy(owner_user_id)
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO transcription_policy(owner_user_id, mode, start_time, window_hours, timezone, manual_active, paused) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id) DO UPDATE SET "
            "manual_active=excluded.manual_active, paused=excluded.paused",
            (owner_user_id, policy["mode"], policy["start_time"], policy["window_hours"],
             policy["timezone"], int(active), int(not active)),
        )
        conn.commit()
    finally:
        conn.close()
    return get_transcription_policy(owner_user_id)


def pending_job_owners() -> list[str | None]:
    conn = get_connection()
    try:
        return [row["owner_user_id"] for row in conn.execute(
            "SELECT DISTINCT s.owner_user_id FROM jobs j JOIN sessions s ON s.id = j.session_id "
            "WHERE j.status = 'pending'"
        )]
    finally:
        conn.close()


def clear_idle_manual_transcription() -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE transcription_policy SET manual_active = 0 WHERE manual_active = 1 "
            "AND NOT EXISTS (SELECT 1 FROM sessions s JOIN jobs j ON j.session_id = s.id "
            "WHERE s.owner_user_id = transcription_policy.owner_user_id "
            "AND j.status IN ('pending', 'processing'))"
        )
        conn.commit()
    finally:
        conn.close()


def get_job_progress(session_id: str) -> dict:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS total, "
            "COALESCE(SUM(status = 'done'), 0) AS done, "
            "COALESCE(SUM(status = 'processing'), 0) AS processing, "
            "COALESCE(SUM(status = 'pending'), 0) AS pending, "
            "COALESCE(SUM(status = 'failed'), 0) AS failed, "
            "GROUP_CONCAT(DISTINCT CASE WHEN status = 'done' THEN model END) AS models "
            "FROM jobs WHERE session_id = ?", (session_id,)
        ).fetchone()
        total = row["total"]
        return {"total": total, "done": row["done"], "processing": row["processing"],
                "pending": row["pending"], "failed": row["failed"],
                "models": sorted(row["models"].split(",")) if row["models"] else [],
                "percent": round(100 * row["done"] / total) if total else 0}
    finally:
        conn.close()


def audio_cleanup_candidates(owner_user_id: str, cutoff_iso: str,
                             session_id: str | None = None, chunk_num: int | None = None) -> list[dict]:
    conn = get_connection()
    try:
        specific = "AND c.session_id = ? AND c.chunk_num = ? " if session_id is not None and chunk_num is not None else ""
        args = (owner_user_id, cutoff_iso, session_id, chunk_num) if specific else (owner_user_id, cutoff_iso)
        return [dict(row) for row in conn.execute(
            "SELECT c.session_id, c.chunk_num, c.path, c.denoised_path, c.size_bytes "
            "FROM chunks c JOIN sessions s ON s.id = c.session_id "
            "WHERE s.owner_user_id = ? AND s.ended_at IS NOT NULL AND s.ended_at < ? "
            "AND s.status IN ('stopped', 'failed') AND c.audio_purged_at IS NULL " + specific +
            "AND NOT EXISTS (SELECT 1 FROM chunks other LEFT JOIN jobs j "
            "ON j.session_id = other.session_id AND j.chunk_num = other.chunk_num "
            "WHERE other.session_id = s.id AND (j.id IS NULL OR j.status != 'done')) "
            "AND NOT EXISTS (SELECT 1 FROM relabel_queue r WHERE r.session_id = s.id) "
            "ORDER BY s.ended_at, c.chunk_num",
            args,
        )]
    finally:
        conn.close()


def mark_audio_purged(session_id: str, chunk_num: int, path: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE chunks SET audio_purged_at = ?, denoised_path = NULL "
            "WHERE session_id = ? AND chunk_num = ? AND path = ? AND audio_purged_at IS NULL",
            (_now_iso(), session_id, chunk_num, path),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), "
            "version INTEGER NOT NULL"
            ")"
        )
        conn.execute(
            "INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, ?)",
            (CURRENT_SCHEMA_VERSION,),
        )
        prior_version_row = conn.execute(
            "SELECT version FROM schema_version WHERE id = 1"
        ).fetchone()
        prior_version = prior_version_row["version"] if prior_version_row else 0
        conn.execute(
            "UPDATE schema_version SET version = ? WHERE id = 1",
            (CURRENT_SCHEMA_VERSION,),
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "id TEXT PRIMARY KEY, "
            "device_id TEXT NOT NULL, "
            "started_at TEXT NOT NULL, "
            "ended_at TEXT, "
            "status TEXT NOT NULL DEFAULT 'recording'"
            ")"
        )
        _add_column_if_missing(conn, "sessions", "owner_user_id", "TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_user_id)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS chunks ("
            "session_id TEXT NOT NULL, "
            "chunk_num INTEGER NOT NULL, "
            "sha256 TEXT NOT NULL, "
            "size_bytes INTEGER NOT NULL, "
            "path TEXT NOT NULL, "
            "uploaded_at TEXT NOT NULL, "
            "PRIMARY KEY (session_id, chunk_num), "
            "FOREIGN KEY (session_id) REFERENCES sessions(id)"
            ")"
        )
        _add_column_if_missing(conn, "chunks", "started_at", "TEXT")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS jobs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "session_id TEXT NOT NULL, "
            "chunk_num INTEGER NOT NULL, "
            "status TEXT NOT NULL DEFAULT 'pending', "
            "attempts INTEGER NOT NULL DEFAULT 0, "
            "created_at TEXT NOT NULL, "
            "updated_at TEXT NOT NULL, "
            "UNIQUE (session_id, chunk_num), "
            "FOREIGN KEY (session_id) REFERENCES sessions(id)"
            ")"
        )
        _add_column_if_missing(conn, "jobs", "model", "TEXT")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS transcript_segments ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "session_id TEXT NOT NULL, "
            "chunk_num INTEGER NOT NULL, "
            "start_ms INTEGER NOT NULL, "
            "end_ms INTEGER NOT NULL, "
            "text TEXT NOT NULL, "
            "created_at TEXT NOT NULL, "
            "FOREIGN KEY (session_id) REFERENCES sessions(id)"
            ")"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS recording_state ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), "
            "active_session_id TEXT, "
            "device_id TEXT, "
            "started_at TEXT"
            ")"
        )
        conn.execute(
            "INSERT OR IGNORE INTO recording_state "
            "(id, active_session_id, device_id, started_at) "
            "VALUES (1, NULL, NULL, NULL)"
        )
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5("
            "text, session_id UNINDEXED, "
            "content='transcript_segments', content_rowid='id')"
        )
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS transcript_segments_ai "
            "AFTER INSERT ON transcript_segments BEGIN "
            "INSERT INTO segments_fts(rowid, text, session_id) "
            "VALUES (new.id, new.text, new.session_id); END"
        )
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS transcript_segments_ad "
            "AFTER DELETE ON transcript_segments BEGIN "
            "INSERT INTO segments_fts(segments_fts, rowid, text, session_id) "
            "VALUES ('delete', old.id, old.text, old.session_id); END"
        )
        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS transcript_segments_au "
            "AFTER UPDATE ON transcript_segments BEGIN "
            "INSERT INTO segments_fts(segments_fts, rowid, text, session_id) "
            "VALUES ('delete', old.id, old.text, old.session_id); "
            "INSERT INTO segments_fts(rowid, text, session_id) "
            "VALUES (new.id, new.text, new.session_id); END"
        )
        if prior_version < 5:
            conn.execute("INSERT INTO segments_fts(segments_fts) VALUES('rebuild')")

        # Fase 7 — speaker labelling (schema_version 6). Additive.
        _add_column_if_missing(conn, "transcript_segments", "speaker", "TEXT")
        # GPU worker / queue support. Additive.
        _add_column_if_missing(conn, "jobs", "worker", "TEXT")
        _add_column_if_missing(conn, "chunks", "denoised_path", "TEXT")
        _add_column_if_missing(conn, "chunks", "audio_purged_at", "TEXT")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audio_retention ("
            "owner_user_id TEXT PRIMARY KEY, automatic INTEGER NOT NULL DEFAULT 0, "
            "days INTEGER NOT NULL DEFAULT 90)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS transcription_policy ("
            "owner_user_id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'automatic', "
            "start_time TEXT NOT NULL DEFAULT '22:00', window_hours INTEGER NOT NULL DEFAULT 8, "
            "timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo', "
            "manual_active INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0)"
        )
        _add_column_if_missing(conn, "transcription_policy", "paused", "INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS voiceprint ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), "
            "embedding BLOB, dim INTEGER, sample_seconds REAL, "
            "model TEXT, updated_at TEXT)"
        )
        conn.execute(
            "INSERT OR IGNORE INTO voiceprint "
            "(id, embedding, dim, sample_seconds, model, updated_at) "
            "VALUES (1, NULL, NULL, NULL, NULL, NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS account_voiceprints ("
            "owner_user_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, dim INTEGER NOT NULL, "
            "sample_seconds REAL NOT NULL, model TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS relabel_queue ("
            "session_id TEXT NOT NULL, chunk_num INTEGER NOT NULL, "
            "created_at TEXT NOT NULL, PRIMARY KEY (session_id, chunk_num))"
        )
        _add_column_if_missing(conn, "relabel_queue", "status", "TEXT NOT NULL DEFAULT 'pending'")
        _add_column_if_missing(conn, "relabel_queue", "attempts", "INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "relabel_queue", "next_attempt_at", "TEXT")
        _add_column_if_missing(conn, "relabel_queue", "lease_until", "TEXT")
        _add_column_if_missing(conn, "relabel_queue", "claim_token", "TEXT")
        # Account-scoped participant identities. Legacy speaker/voiceprint data
        # stays intact; no text or old `other` label is backfilled as identity.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS voice_identities ("
            "id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, "
            "display_name TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, "
            "UNIQUE(owner_user_id, id))"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_identities_active_name "
            "ON voice_identities(owner_user_id, lower(display_name)) WHERE deleted_at IS NULL"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS voice_templates ("
            "id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, identity_id TEXT NOT NULL, "
            "embedding BLOB NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL, "
            "sample_seconds REAL NOT NULL, source_segment_id INTEGER NOT NULL, "
            "source_session_id TEXT NOT NULL, source_chunk_num INTEGER NOT NULL, "
            "created_at TEXT NOT NULL, deleted_at TEXT, "
            "FOREIGN KEY(owner_user_id, identity_id) "
            "REFERENCES voice_identities(owner_user_id, id))"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_voice_templates_owner_model "
            "ON voice_templates(owner_user_id, model) WHERE deleted_at IS NULL"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS segment_identity_decisions ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id TEXT NOT NULL, "
            "segment_id INTEGER NOT NULL, identity_id TEXT, "
            "action TEXT NOT NULL CHECK(action IN ('confirm', 'correct', 'ignore', 'undo')), "
            "created_at TEXT NOT NULL, FOREIGN KEY(segment_id) REFERENCES transcript_segments(id))"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_segment_identity_decisions_owner_segment "
            "ON segment_identity_decisions(owner_user_id, segment_id, id DESC)"
        )
        # Legacy me/other labels were assigned from an uncalibrated cosine score.
        # Manual speaker corrections live in the clients, not in this column.
        if prior_version < 12:
            conn.execute("UPDATE transcript_segments SET speaker = NULL WHERE speaker IN ('me', 'other')")
        conn.commit()
    finally:
        conn.close()


def _add_column_if_missing(conn, table: str, column: str, decl: str) -> None:
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def create_session_if_missing(session_id: str, device_id: str, started_at: str,
                              owner_user_id: str | None = None) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, device_id, started_at, status, owner_user_id) "
            "VALUES (?, ?, ?, 'recording', ?)",
            (session_id, device_id, started_at, owner_user_id),
        )
        owner = conn.execute("SELECT owner_user_id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if owner is None or owner["owner_user_id"] != owner_user_id:
            raise ValueError("session belongs to a different account")
        conn.commit()
    finally:
        conn.close()


def chunk_exists(session_id: str, chunk_num: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT 1 FROM chunks WHERE session_id = ? AND chunk_num = ?",
            (session_id, chunk_num),
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def insert_chunk(session_id: str, chunk_num: int, sha256: str, size_bytes: int, path: str,
                 started_at: str | None = None) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO chunks (session_id, chunk_num, sha256, size_bytes, path, uploaded_at, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, chunk_num, sha256, size_bytes, path, _now_iso(), started_at),
        )
        conn.commit()
    finally:
        conn.close()


def complete_session(session_id: str, status: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE sessions SET ended_at = ?, status = ? WHERE id = ?",
            (_now_iso(), status, session_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def create_job_if_missing(session_id: str, chunk_num: int) -> None:
    conn = get_connection()
    try:
        now = _now_iso()
        conn.execute(
            "INSERT OR IGNORE INTO jobs "
            "(session_id, chunk_num, status, attempts, created_at, updated_at) "
            "VALUES (?, ?, 'pending', 0, ?, ?)",
            (session_id, chunk_num, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def session_owned_by(session_id: str, owner_user_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT 1 FROM sessions WHERE id = ? AND owner_user_id = ?", (session_id, owner_user_id)
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def session_exists(session_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,))
        return cur.fetchone() is not None
    finally:
        conn.close()


def get_segments(session_id: str) -> list[dict]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, chunk_num, start_ms, end_ms, text, speaker FROM transcript_segments "
            "WHERE session_id = ? ORDER BY chunk_num, start_ms",
            (session_id,),
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def next_pending_job() -> dict | None:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, session_id, chunk_num, attempts FROM jobs "
            "WHERE status = 'pending' ORDER BY id LIMIT 1"
        )
        row = cur.fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def claim_next_job(worker: str, allowed_owners: list[str | None] | None = None) -> dict | None:
    """Marca o job 'pending' mais antigo como 'processing' e o devolve, numa
    única escrita atômica — dois workers (servidor e notebook) nunca pegam o
    mesmo. `None` se não há job pendente."""
    if allowed_owners is not None and not allowed_owners:
        return None
    conn = get_connection()
    try:
        where = "j.status='pending'"
        args: list = []
        if allowed_owners is not None:
            ids = [owner for owner in allowed_owners if owner is not None]
            parts = []
            if ids:
                parts.append("s.owner_user_id IN (" + ",".join("?" for _ in ids) + ")")
                args.extend(ids)
            if None in allowed_owners:
                parts.append("s.owner_user_id IS NULL")
            where += " AND (" + " OR ".join(parts) + ")"
        row = conn.execute(
            "UPDATE jobs SET status='processing', worker=?, updated_at=? "
            f"WHERE id = (SELECT j.id FROM jobs j JOIN sessions s ON s.id = j.session_id WHERE {where} ORDER BY j.id LIMIT 1) "
            "RETURNING id, session_id, chunk_num, attempts",
            (worker, _now_iso(), *args),
        ).fetchone()
        conn.commit()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def get_job(job_id: int) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, session_id, chunk_num, status, attempts, worker "
            "FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def mark_job_processing(job_id: int) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE jobs SET status = 'processing', updated_at = ? WHERE id = ?",
            (_now_iso(), job_id),
        )
        conn.commit()
    finally:
        conn.close()


def mark_job_done(job_id: int, model: str | None = None) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE jobs SET status = 'done', model = ?, updated_at = ? WHERE id = ?",
            (model, _now_iso(), job_id),
        )
        conn.commit()
    finally:
        conn.close()


def mark_job_retry_or_failed(job_id: int, attempts: int, max_attempts: int) -> str:
    new_attempts = attempts + 1
    new_status = "failed" if new_attempts >= max_attempts else "pending"
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE jobs SET status = ?, attempts = ?, updated_at = ? WHERE id = ?",
            (new_status, new_attempts, _now_iso(), job_id),
        )
        conn.commit()
        return new_status
    finally:
        conn.close()


def reset_stuck_jobs(max_attempts: int) -> int:
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE jobs SET "
            "attempts = attempts + 1, "
            "status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END, "
            "updated_at = ? "
            "WHERE status = 'processing'",
            (max_attempts, _now_iso()),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def backfill_jobs() -> int:
    conn = get_connection()
    try:
        now = _now_iso()
        cur = conn.execute(
            "INSERT OR IGNORE INTO jobs "
            "(session_id, chunk_num, status, attempts, created_at, updated_at) "
            "SELECT session_id, chunk_num, 'pending', 0, ?, ? FROM chunks",
            (now, now),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def chunk_audio_path(chunk: dict) -> str:
    """Caminho do áudio a usar pra este chunk: o denoised (mandado pelo
    notebook) se existir em disco, senão o cru. Pura — sem I/O de DB."""
    den = chunk.get("denoised_path")
    if den and os.path.exists(den):
        return den
    return chunk["path"]


def set_chunk_denoised(session_id: str, chunk_num: int, path: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE chunks SET denoised_path = ? WHERE session_id = ? AND chunk_num = ?",
            (path, session_id, chunk_num),
        )
        conn.commit()
    finally:
        conn.close()


def get_chunk(session_id: str, chunk_num: int) -> dict | None:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT session_id, chunk_num, sha256, size_bytes, path, denoised_path FROM chunks "
            "WHERE session_id = ? AND chunk_num = ?",
            (session_id, chunk_num),
        )
        row = cur.fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()



def insert_segments(session_id: str, chunk_num: int, segments: list) -> None:
    conn = get_connection()
    try:
        now = _now_iso()
        conn.executemany(
            "INSERT INTO transcript_segments "
            "(session_id, chunk_num, start_ms, end_ms, text, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                (session_id, chunk_num, seg.start_ms, seg.end_ms, seg.text, now)
                for seg in segments
            ],
        )
        conn.commit()
    finally:
        conn.close()


def get_recording_state() -> dict:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT active_session_id, device_id, started_at "
            "FROM recording_state WHERE id = 1"
        )
        return dict(cur.fetchone())
    finally:
        conn.close()


def set_recording_state(session_id: str, device_id: str, started_at: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE recording_state SET active_session_id = ?, device_id = ?, started_at = ? "
            "WHERE id = 1",
            (session_id, device_id, started_at),
        )
        conn.commit()
    finally:
        conn.close()


def clear_recording_state() -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE recording_state SET active_session_id = NULL, device_id = NULL, started_at = NULL "
            "WHERE id = 1"
        )
        conn.commit()
    finally:
        conn.close()


def get_session_status(session_id: str) -> str | None:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT status FROM sessions WHERE id = ?", (session_id,))
        row = cur.fetchone()
        return row["status"] if row is not None else None
    finally:
        conn.close()


def get_job_statuses(session_id: str) -> list[str]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT status FROM jobs WHERE session_id = ?", (session_id,))
        return [row["status"] for row in cur.fetchall()]
    finally:
        conn.close()


def compute_session_status(session_id: str) -> str:
    if get_session_status(session_id) == "recording":
        return "recording"
    job_statuses = get_job_statuses(session_id)
    if any(status in ("pending", "processing") for status in job_statuses):
        return "transcribing"
    if any(status == "failed" for status in job_statuses):
        return "error"
    return "ready"


def get_session_text(session_id: str) -> str | None:
    segments = get_segments(session_id)
    if not segments:
        return None
    return " ".join(seg["text"] for seg in segments)


def distinct_years(owner_user_id: str) -> list[int]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT DISTINCT CAST(substr(started_at, 1, 4) AS INTEGER) AS year "
            "FROM sessions WHERE owner_user_id = ? ORDER BY year DESC",
            (owner_user_id,),
        )
        return [row["year"] for row in cur.fetchall()]
    finally:
        conn.close()


def distinct_months(year: int, owner_user_id: str) -> list[int]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT DISTINCT CAST(substr(started_at, 6, 2) AS INTEGER) AS month "
            "FROM sessions WHERE owner_user_id = ? AND substr(started_at, 1, 4) = ? ORDER BY month DESC",
            (owner_user_id, f"{year:04d}"),
        )
        return [row["month"] for row in cur.fetchall()]
    finally:
        conn.close()


def distinct_days(year: int, month: int, owner_user_id: str) -> list[str]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT DISTINCT substr(started_at, 1, 10) AS day FROM sessions "
            "WHERE owner_user_id = ? AND substr(started_at, 1, 4) = ? AND substr(started_at, 6, 2) = ? "
            "ORDER BY day DESC",
            (owner_user_id, f"{year:04d}", f"{month:02d}"),
        )
        return [row["day"] for row in cur.fetchall()]
    finally:
        conn.close()


def get_sessions_by_date(date: str, owner_user_id: str) -> list:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, device_id, started_at, ended_at, status FROM sessions "
            "WHERE owner_user_id = ? AND substr(started_at, 1, 10) = ? ORDER BY started_at ASC",
            (owner_user_id, date),
        )
        return cur.fetchall()
    finally:
        conn.close()


def get_recent_sessions(limit: int, owner_user_id: str) -> list:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, device_id, started_at, ended_at, status FROM sessions "
            "WHERE owner_user_id = ? ORDER BY started_at DESC LIMIT ?",
            (owner_user_id, limit),
        )
        return cur.fetchall()
    finally:
        conn.close()


def search_segments(match_expr: str, owner_user_id: str, speaker: str | None = None) -> list:
    conn = get_connection()
    try:
        sql = (
            "SELECT segments_fts.session_id AS session_id, "
            "snippet(segments_fts, 0, char(2), char(3), '…', 12) AS snippet, "
            "s.started_at AS started_at "
            "FROM segments_fts "
            "JOIN sessions s ON s.id = segments_fts.session_id "
            "JOIN transcript_segments ts ON ts.id = segments_fts.rowid "
            "WHERE segments_fts MATCH ? AND s.owner_user_id = ?"
        )
        params: list = [match_expr, owner_user_id]
        if speaker is not None:
            sql += " AND ts.speaker = ?"
            params.append(speaker)
        sql += " ORDER BY rank"
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


# ── Fase 7: speaker labelling ────────────────────────────────────────────

def get_segments_for_chunk(session_id: str, chunk_num: int) -> list[dict]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT id, start_ms, end_ms, text, speaker FROM transcript_segments "
            "WHERE session_id = ? AND chunk_num = ? ORDER BY start_ms",
            (session_id, chunk_num),
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def set_chunk_speakers_if_voiceprint_current(session_id: str, chunk_num: int,
                                              updated_at: str, speakers: dict[int, str]) -> bool:
    """Apply labels atomically only for the voiceprint used to calculate them."""
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        owner = conn.execute("SELECT owner_user_id FROM sessions WHERE id=?", (session_id,)).fetchone()
        if owner is None:
            conn.rollback()
            return False
        if owner["owner_user_id"] is None:
            current = conn.execute("SELECT updated_at FROM voiceprint WHERE id=1 AND embedding IS NOT NULL").fetchone()
        else:
            current = conn.execute(
                "SELECT updated_at FROM account_voiceprints WHERE owner_user_id=?",
                (owner["owner_user_id"],),
            ).fetchone()
        if current is None or current["updated_at"] != updated_at:
            conn.rollback()
            return False
        conn.executemany(
            "UPDATE transcript_segments SET speaker=? WHERE id=? AND session_id=? AND chunk_num=?",
            [(speaker, segment_id, session_id, chunk_num) for segment_id, speaker in speakers.items()],
        )
        conn.commit()
        return True
    finally:
        conn.close()


def clear_all_speakers(owner_user_id: str | None = None) -> int:
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE transcript_segments SET speaker = NULL WHERE speaker IS NOT NULL "
            "AND session_id IN (SELECT id FROM sessions WHERE owner_user_id IS ?)",
            (owner_user_id,),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def get_session_owner(session_id: str) -> str | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT owner_user_id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return row["owner_user_id"] if row is not None else None
    finally:
        conn.close()


def get_voiceprint(owner_user_id: str | None = None) -> dict | None:
    conn = get_connection()
    try:
        if owner_user_id is None:
            row = conn.execute(
                "SELECT embedding, dim, sample_seconds, model, updated_at "
                "FROM voiceprint WHERE id = 1"
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT embedding, dim, sample_seconds, model, updated_at "
                "FROM account_voiceprints WHERE owner_user_id = ?", (owner_user_id,)
            ).fetchone()
        if row is None or row["embedding"] is None:
            return None
        return dict(row)
    finally:
        conn.close()


def set_voiceprint(embedding: bytes, dim: int, sample_seconds: float, model: str,
                   owner_user_id: str | None = None) -> None:
    conn = get_connection()
    try:
        updated_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        if owner_user_id is None:
            conn.execute(
                "UPDATE voiceprint SET embedding = ?, dim = ?, sample_seconds = ?, "
                "model = ?, updated_at = ? WHERE id = 1",
                (embedding, dim, sample_seconds, model, updated_at),
            )
        else:
            conn.execute(
                "INSERT INTO account_voiceprints "
                "(owner_user_id, embedding, dim, sample_seconds, model, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id) DO UPDATE SET "
                "embedding = excluded.embedding, dim = excluded.dim, "
                "sample_seconds = excluded.sample_seconds, model = excluded.model, "
                "updated_at = excluded.updated_at",
                (owner_user_id, embedding, dim, sample_seconds, model, updated_at),
            )
        conn.commit()
    finally:
        conn.close()


def clear_voiceprint(owner_user_id: str | None = None) -> None:
    conn = get_connection()
    try:
        if owner_user_id is None:
            conn.execute(
                "UPDATE voiceprint SET embedding = NULL, dim = NULL, "
                "sample_seconds = NULL, model = NULL, updated_at = NULL WHERE id = 1"
            )
        else:
            conn.execute("DELETE FROM account_voiceprints WHERE owner_user_id = ?", (owner_user_id,))
        conn.commit()
    finally:
        conn.close()


def enqueue_relabel_all(owner_user_id: str | None = None) -> int:
    conn = get_connection()
    try:
        now = _now_iso()
        cur = conn.execute(
            "INSERT INTO relabel_queue (session_id, chunk_num, created_at) "
            "SELECT c.session_id, c.chunk_num, ? FROM chunks c "
            "JOIN sessions s ON s.id = c.session_id WHERE s.owner_user_id IS ? "
            "ON CONFLICT(session_id, chunk_num) DO UPDATE SET created_at=excluded.created_at, "
            "status='pending', attempts=0, next_attempt_at=NULL, lease_until=NULL, claim_token=NULL",
            (now, owner_user_id),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def enqueue_relabel(session_id: str, chunk_num: int) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO relabel_queue (session_id, chunk_num, created_at) "
            "VALUES (?, ?, ?) ON CONFLICT(session_id, chunk_num) DO UPDATE SET "
            "created_at=excluded.created_at, status='pending', attempts=0, "
            "next_attempt_at=NULL, lease_until=NULL, claim_token=NULL",
            (session_id, chunk_num, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()


def next_relabel_task() -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT session_id, chunk_num FROM relabel_queue WHERE status='pending' "
            "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) "
            "ORDER BY created_at, session_id, chunk_num LIMIT 1", (_now_iso(),)
        ).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def clear_relabel_task(session_id: str, chunk_num: int) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM relabel_queue WHERE session_id = ? AND chunk_num = ?",
            (session_id, chunk_num),
        )
        conn.commit()
    finally:
        conn.close()


def relabel_counts(owner_user_id: str | None = None) -> dict[str, int]:
    """Only expose queue counts belonging to the requested account."""
    counts = {"pending": 0, "processing": 0, "failed": 0}
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT r.status, count(*) AS total FROM relabel_queue r "
            "JOIN sessions s ON s.id=r.session_id WHERE s.owner_user_id IS ? "
            "GROUP BY r.status", (owner_user_id,),
        ).fetchall()
        for row in rows:
            if row["status"] in counts:
                counts[row["status"]] = row["total"]
        return counts
    finally:
        conn.close()


def clear_relabel_for_owner(owner_user_id: str | None = None) -> int:
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM relabel_queue WHERE session_id IN "
            "(SELECT id FROM sessions WHERE owner_user_id IS ?)", (owner_user_id,),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def claim_next_relabel_task(lease_seconds: int = 1800) -> dict | None:
    """Claim one task atomically; an expired lease is recoverable after a crash."""
    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = _now_iso()
        row = conn.execute(
            "SELECT session_id, chunk_num, attempts FROM relabel_queue WHERE "
            "(status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) "
            "OR (status='processing' AND lease_until <= ?) "
            "ORDER BY created_at, session_id, chunk_num LIMIT 1", (now, now),
        ).fetchone()
        if row is None:
            conn.commit()
            return None
        token = uuid.uuid4().hex
        lease = (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            "UPDATE relabel_queue SET status='processing', claim_token=?, lease_until=?, "
            "attempts=attempts+1 WHERE session_id=? AND chunk_num=?",
            (token, lease, row["session_id"], row["chunk_num"]),
        )
        conn.commit()
        return {"session_id": row["session_id"], "chunk_num": row["chunk_num"],
                "attempts": row["attempts"] + 1, "claim_token": token}
    finally:
        conn.close()


def complete_relabel_task(task: dict) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM relabel_queue WHERE session_id=? AND chunk_num=? "
            "AND status='processing' AND claim_token=?",
            (task["session_id"], task["chunk_num"], task["claim_token"]),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def retry_relabel_task(task: dict, max_attempts: int = 5) -> bool:
    attempts = task["attempts"]
    failed = attempts >= max_attempts
    delay = min(3600, 30 * (2 ** (attempts - 1)))
    due = (datetime.now(timezone.utc) + timedelta(seconds=delay)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE relabel_queue SET status=?, next_attempt_at=?, lease_until=NULL, claim_token=NULL "
            "WHERE session_id=? AND chunk_num=? AND status='processing' AND claim_token=?",
            ("failed" if failed else "pending", None if failed else due,
             task["session_id"], task["chunk_num"], task["claim_token"]),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def compute_turns(session_id: str) -> list[dict]:
    """Consecutive same-speaker segments merged, retaining their time range."""
    from datetime import datetime, timedelta, timezone

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT ts.id, ts.chunk_num, ts.start_ms, ts.end_ms, ts.text, ts.speaker, "
            "c.started_at AS chunk_started_at, s.started_at AS session_started_at "
            "FROM transcript_segments ts "
            "JOIN sessions s ON s.id = ts.session_id "
            "LEFT JOIN chunks c ON c.session_id = ts.session_id AND c.chunk_num = ts.chunk_num "
            "WHERE ts.session_id = ? ORDER BY ts.chunk_num, ts.start_ms", (session_id,),
        ).fetchall()
    finally:
        conn.close()
    turns: list[dict] = []
    for seg in rows:
        speaker = seg["speaker"]
        text = seg["text"]
        try:
            base = datetime.fromisoformat((seg["chunk_started_at"] or seg["session_started_at"]).replace("Z", "+00:00"))
            if base.tzinfo is None:
                base = base.replace(tzinfo=timezone.utc)
            # Older chunks have no start metadata. Keep their time unknown rather than inventing a clock time.
            start_at = (base + timedelta(milliseconds=seg["start_ms"])).isoformat() if seg["chunk_started_at"] else None
            end_at = (base + timedelta(milliseconds=seg["end_ms"])).isoformat() if seg["chunk_started_at"] else None
        except (TypeError, ValueError, OverflowError):
            start_at = end_at = None
        turns.append({"id": seg["id"], "speaker": speaker, "text": text, "start_at": start_at,
                      "end_at": end_at})
    return turns


def get_chunks_for_session(session_id: str) -> list[dict]:
    conn = get_connection()
    try:
        cur = conn.execute(
            "SELECT chunk_num, path FROM chunks WHERE session_id = ? ORDER BY chunk_num",
            (session_id,),
        )
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()

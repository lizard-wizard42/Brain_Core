import { query } from '../config/database';

export async function ownedSessionIds(userId: string): Promise<Set<string>> {
  const rows = await query<{ session_id: string }>(`
    SELECT session_id::text FROM mobile_sessions WHERE user_id = $1
    UNION SELECT session_id::text FROM browser_recording_sessions WHERE user_id = $1
  `, [userId]);
  return new Set(rows.map((row) => row.session_id));
}

export async function ownedDates(userId: string): Promise<string[]> {
  const rows = await query<{ day: string }>(`
    SELECT DISTINCT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    FROM (
      SELECT started_at FROM mobile_sessions WHERE user_id = $1
      UNION ALL SELECT started_at FROM browser_recording_sessions WHERE user_id = $1
    ) own
    ORDER BY day DESC
  `, [userId]);
  return rows.map((row) => row.day);
}

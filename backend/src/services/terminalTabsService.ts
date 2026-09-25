import { query } from '../config/database';
import { hasTerminalWorkspaceSession } from './terminalService';

export interface TerminalTabRecord {
  request_key: string;
  title: string;
  cwd: string | null;
  is_active: boolean;
  last_seen_at: string;
}

export async function upsertTerminalTab(params: {
  userId: string;
  requestKey: string;
  title: string;
  cwd?: string | null;
  isActive?: boolean;
}): Promise<void> {
  const { userId, requestKey, title, cwd = null, isActive = false } = params;

  if (isActive) {
    await query(
      `UPDATE terminal_tabs
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE user_id = $1
         AND request_key <> $2
         AND is_active = TRUE`,
      [userId, requestKey],
    );
  }

  await query(
    `INSERT INTO terminal_tabs (user_id, request_key, title, cwd, is_active, last_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (user_id, request_key)
     DO UPDATE SET
       title = EXCLUDED.title,
       cwd = EXCLUDED.cwd,
       is_active = EXCLUDED.is_active,
       last_seen_at = NOW(),
       updated_at = NOW()`,
    [userId, requestKey, title, cwd, isActive],
  );
}

export async function listTerminalTabs(userId: string): Promise<TerminalTabRecord[]> {
  const rows = await query<TerminalTabRecord>(
    `SELECT request_key, title, cwd, is_active, last_seen_at
     FROM terminal_tabs
     WHERE user_id = $1
     ORDER BY is_active DESC, last_seen_at DESC`,
    [userId],
  );

  const activeRows = rows.filter((row) => hasTerminalWorkspaceSession(userId, row.request_key));
  const staleRows = rows.filter((row) => !hasTerminalWorkspaceSession(userId, row.request_key));

  if (staleRows.length) {
    await query(
      `DELETE FROM terminal_tabs
       WHERE user_id = $1
         AND request_key = ANY($2::text[])`,
      [userId, staleRows.map((row) => row.request_key)],
    );
  }

  return activeRows;
}

export async function deleteTerminalTab(userId: string, requestKey: string): Promise<void> {
  await query(
    `DELETE FROM terminal_tabs
     WHERE user_id = $1
       AND request_key = $2`,
    [userId, requestKey],
  );
}

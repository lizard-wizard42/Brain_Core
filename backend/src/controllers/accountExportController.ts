import type { Response } from 'express';
import { query } from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { logError, logInfo } from '../utils/logger';

/**
 * LGPD art. 18 (access / portability): a machine-readable copy of the caller's own data.
 * Deliberately excludes credentials (password hash, 2FA secrets, integration tokens)
 * and binary files; recordings are exported from the Memory service separately.
 */
export async function exportAccountData(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId!;
  try {
    const [profile, pages, notes, contacts, grants] = await Promise.all([
      query(`SELECT id, email, name, role, created_at, last_login_at, two_factor_enabled
             FROM users WHERE id = $1`, [userId]),
      query(`SELECT id, parent_page_id, title, slug, type, icon, tags, status, due_date,
                    content, sort_order, created_at, updated_at, deleted_at
             FROM pages WHERE owner_user_id = $1 ORDER BY created_at`, [userId]),
      query(`SELECT id, title, body, color, checklist, tags, reminder_date, reminder_time,
                    reminder_label, reminder_repeat_daily, created_at, updated_at
             FROM remember_notes WHERE user_id = $1::text ORDER BY created_at`, [userId]),
      query(`SELECT c.status, c.created_at, u.name AS contact_name, u.email AS contact_email
             FROM contacts c
             JOIN users u ON u.id = CASE WHEN c.requester_user_id = $1 THEN c.addressee_user_id
                                         ELSE c.requester_user_id END
             WHERE c.requester_user_id = $1 OR c.addressee_user_id = $1`, [userId]),
      query(`SELECT g.page_id, g.role, g.granted_at FROM page_grants g WHERE g.user_id = $1`, [userId]),
    ]);

    logInfo('account.export', { userId, pages: pages.length, notes: notes.length });
    res.setHeader('Content-Disposition', 'attachment; filename="brain-core-export.json"');
    res.json({
      exported_at: new Date().toISOString(),
      format_version: 1,
      profile: profile[0] ?? null,
      pages,
      quick_notes: notes,
      contacts,
      shared_with_me: grants,
    });
  } catch (error) {
    logError('account.export.failed', { userId, detail: String(error) });
    res.status(500).json({ error: 'Falha ao exportar os dados' });
  }
}

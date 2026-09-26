import { Response } from 'express';
import { query } from '../config/database';
import { PageSummary } from '../types';
import { AuthRequest } from '../middleware/auth';

export async function getTree(req: AuthRequest, res: Response): Promise<void> {
  try {
    const pages = await query<PageSummary>(
      'SELECT id, parent_page_id, title, slug, type, icon, is_section, tags, status, due_date, working_directory, sort_order, updated_at FROM pages WHERE owner_user_id = $1 AND deleted_at IS NULL ORDER BY sort_order, title',
      [req.userId],
    );
    res.json({ pages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tree', detail: String(err) });
  }
}

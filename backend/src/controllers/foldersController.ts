import { Request, Response } from 'express';
import { query } from '../config/database';
import { PageSummary } from '../types';
import { logError } from '../utils/logger';

export async function getTree(req: Request, res: Response): Promise<void> {
  try {
    const pages = await query<PageSummary>(
      'SELECT id, parent_page_id, title, slug, type, icon, is_section, tags, status, due_date, working_directory, sort_order, updated_at FROM pages WHERE deleted_at IS NULL ORDER BY sort_order, title'
    );
    res.json({ pages });
  } catch (err) {
    logError('folders.tree.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch tree' });
  }
}

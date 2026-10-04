import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { searchNotes } from '../services/noteSearch';

export async function search(req: AuthRequest, res: Response) {
  const text = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const kind = req.query.kind ?? 'all';
  const rawOffset = req.query.offset ?? '0';
  if (!text || text.length > 200 || !['all', 'pages', 'notes'].includes(String(kind)) ||
      typeof rawOffset !== 'string' || !/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) {
    res.status(400).json({ error: 'Invalid search' }); return;
  }
  try { res.json(await searchNotes(req.userId!, text, String(kind), Number(rawOffset))); }
  catch { res.status(503).json({ error: 'Não foi possível pesquisar. Tente novamente.' }); }
}

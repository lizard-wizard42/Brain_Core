import { Response } from 'express';
import { unlink } from 'fs/promises';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { logError } from '../utils/logger';

interface CustomEmojiRow {
  id: string;
  name: string;
  url: string;
  created_by: string;
  created_at: string;
}

export async function listCustomEmojis(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<CustomEmojiRow>(
      `SELECT id, name, url, created_by, created_at
       FROM custom_emojis
       ORDER BY created_at DESC
       LIMIT 500`
    );
    res.json({ emojis: rows });
  } catch (err) {
    logError('emoji.list.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Falha ao listar emojis customizados' });
  }
}

export async function createCustomEmoji(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PNG não enviado' });
      return;
    }

    const nameRaw = String(req.body?.name ?? '').trim();
    const fallbackName = req.file.originalname.replace(/\.[^/.]+$/, '');
    const name = (nameRaw || fallbackName || 'Emoji').slice(0, 100);
    const url = `/uploads/emojis/${req.file.filename}`;

    const rows = await query<CustomEmojiRow>(
      `INSERT INTO custom_emojis (name, url, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, url, created_by, created_at`,
      [name, url, req.userId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (req.file) await unlink(req.file.path).catch(() => {});
    logError('emoji.create.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Falha ao criar emoji customizado' });
  }
}

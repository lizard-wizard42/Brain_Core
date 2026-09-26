import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { recordUploadedAsset } from '../services/uploadOwnership';

interface CustomEmojiRow {
  id: string;
  name: string;
  url: string;
  created_by: string;
  created_at: string;
}

export async function listCustomEmojis(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await query<CustomEmojiRow>(
      `SELECT id, name, url, created_by, created_at
       FROM custom_emojis WHERE owner_user_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [req.userId],
    );
    res.json({ emojis: rows });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao listar emojis customizados', detail: String(err) });
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
    await recordUploadedAsset(`emojis/${req.file.filename}`, req.userId);

    const rows = await query<CustomEmojiRow>(
      `INSERT INTO custom_emojis (name, url, created_by, owner_user_id)
       VALUES ($1, $2, $3, $3)
       RETURNING id, name, url, created_by, created_at`,
      [name, url, req.userId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Falha ao criar emoji customizado', detail: String(err) });
  }
}

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export async function recordUploadedAsset(relativePath: string, userId: string): Promise<void> {
  const rows = await query(
    `INSERT INTO uploaded_assets (relative_path, owner_user_id)
     VALUES ($1, $2) ON CONFLICT (relative_path) DO UPDATE
     SET owner_user_id = uploaded_assets.owner_user_id
     WHERE uploaded_assets.owner_user_id = EXCLUDED.owner_user_id
     RETURNING relative_path`,
    [relativePath, userId],
  );
  if (!rows.length) throw new Error('Arquivo pertence a outra conta');
}

export async function requireUploadedAssetOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const relativePath = req.path.replace(/^\//, '');
  if (!userId || !relativePath || relativePath.includes('..') || relativePath.includes('\\')) {
    res.status(404).end(); return;
  }
  try {
    const rows = await query(
      `SELECT a.relative_path FROM uploaded_assets a WHERE a.relative_path = $1
       AND (a.owner_user_id = $2 OR EXISTS (
         SELECT 1 FROM pages p JOIN page_grants g ON g.page_id = p.id AND g.user_id = $2
         WHERE p.deleted_at IS NULL AND p.owner_user_id = a.owner_user_id
           AND (p.cover_url = $3 OR position($4 IN p.content::text) > 0)
       ))`,
      [relativePath, userId, `/uploads/${relativePath}`, JSON.stringify(`/uploads/${relativePath}`)],
    );
    if (!rows.length) { res.status(404).end(); return; }
    next();
  } catch { res.status(503).json({ error: 'Não foi possível abrir o arquivo' }); }
}

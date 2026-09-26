import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { AuthRequest } from './auth';

export async function ownerOnly(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: 'Não autenticado' }); return; }
  try {
    const rows = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [req.userId]);
    if (rows[0]?.role !== 'owner') { res.status(403).json({ error: 'Recurso disponível apenas ao proprietário do PC' }); return; }
    next();
  } catch { res.status(503).json({ error: 'Não foi possível verificar a conta' }); }
}

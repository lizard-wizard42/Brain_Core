import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { logError } from '../utils/logger';

const router = Router();

export function healthFailureResponse() {
  return { status: 'error', service: 'brain-core-backend', db: 'disconnected' } as const;
}

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'brain-core-backend', db: 'connected' });
  } catch (err) {
    logError('health.database.unavailable', { detail: String(err) });
    res.status(503).json(healthFailureResponse());
  }
});

export default router;

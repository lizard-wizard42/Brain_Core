import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PC_RETENTION_DAYS, getPcAudioRetention, putPcAudioRetention,
  previewPcAudioCleanup, runPcAudioCleanup } from '../services/audioRetentionService';

function validDays(value: unknown): number | null {
  const days = Number(value);
  return Number.isInteger(days) && PC_RETENTION_DAYS.some(allowed => allowed === days) ? days : null;
}

export async function getAudioRetention(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await getPcAudioRetention(req.userId!)); }
  catch { res.status(503).json({ error: 'Serviço de áudio do PC indisponível' }); }
}

export async function putAudioRetention(req: AuthRequest, res: Response): Promise<void> {
  const days = validDays(req.body?.days);
  if (days === null || typeof req.body?.automatic !== 'boolean') {
    res.status(400).json({ error: 'Política de limpeza inválida' }); return;
  }
  try { res.json(await putPcAudioRetention(req.userId!, { automatic: req.body.automatic, days })); }
  catch { res.status(503).json({ error: 'Serviço de áudio do PC indisponível' }); }
}

export async function previewAudioRetention(req: AuthRequest, res: Response): Promise<void> {
  const days = validDays(req.query.days);
  if (days === null) { res.status(400).json({ error: 'Prazo inválido' }); return; }
  try { res.json(await previewPcAudioCleanup(req.userId!, days)); }
  catch { res.status(503).json({ error: 'Serviço de áudio do PC indisponível' }); }
}

export async function cleanAudioRetention(req: AuthRequest, res: Response): Promise<void> {
  const days = validDays(req.body?.days);
  if (days === null) { res.status(400).json({ error: 'Prazo inválido' }); return; }
  try { res.json(await runPcAudioCleanup(req.userId!, days)); }
  catch { res.status(503).json({ error: 'Serviço de áudio do PC indisponível' }); }
}

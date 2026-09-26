import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { celtwoRequest } from '../remember/celtwoClient';

type Mode = 'automatic' | 'scheduled' | 'manual';
interface Policy { mode: Mode; start_time: string; window_hours: number; timezone: string; manual_active: number }

function path(req: AuthRequest): string {
  return `/api/v1/transcription-policy/${encodeURIComponent(req.userId!)}`;
}

export async function getTranscriptionPolicy(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await celtwoRequest<Policy>(path(req))); }
  catch { res.status(503).json({ error: 'Fila de transcrição indisponível' }); }
}

export async function putTranscriptionPolicy(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body as Partial<Policy> | undefined;
  if (!body || !['automatic', 'scheduled', 'manual'].includes(body.mode || '') ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.start_time || '') ||
      ![2, 4, 8, 12].includes(body.window_hours || 0) ||
      !['America/Sao_Paulo', 'UTC'].includes(body.timezone || '')) {
    res.status(400).json({ error: 'Política de transcrição inválida' }); return;
  }
  try { res.json(await celtwoRequest<Policy>(path(req), { method: 'PUT', body: JSON.stringify(body) })); }
  catch { res.status(503).json({ error: 'Fila de transcrição indisponível' }); }
}

export async function runTranscriptionNow(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await celtwoRequest<Policy>(`${path(req)}/run`, { method: 'POST' })); }
  catch { res.status(503).json({ error: 'Fila de transcrição indisponível' }); }
}

export async function pauseTranscription(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await celtwoRequest<Policy>(`${path(req)}/pause`, { method: 'POST' })); }
  catch { res.status(503).json({ error: 'Fila de transcrição indisponível' }); }
}

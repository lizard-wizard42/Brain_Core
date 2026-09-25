import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { CeltwoUnavailableError } from '../remember/celtwoClient';
import { logError } from '../utils/logger';
import { deleteRememberVoiceprint, enrollRememberVoiceprint, enrollRememberVoiceprintFromSession, setRememberSegmentsSpeaker, getRememberDay, getRememberDays, getRememberMonths, getRememberSearch, getRememberSessions, getRememberStatus, getRememberTranscript, getRememberVoiceprint, getRememberYears, setRememberRecording, setRememberCluster, getRememberPeople, renameRememberPerson, mergeRememberPeople, deleteRememberPerson, getRememberSegmentAudio, getRememberClusterSampleAudio, backfillRememberSpeakers } from '../remember/service';

interface RememberChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

interface RememberNoteRow {
  id: string;
  title: string;
  body: string;
  color: string;
  checklist: RememberChecklistItem[];
  tags: string[];
  reminder_date: string | null;
  reminder_time: string | null;
  reminder_label: string | null;
  reminder_repeat_daily: boolean;
  reminder_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith('#') ? value : `#${value}`))
    .slice(0, 8);
}

function normalizeChecklist(raw: unknown): RememberChecklistItem[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `item-${index}-${Date.now()}`;
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      const checked = record.checked === true;
      return { id, text, checked };
    })
    .filter((item) => item.text.length > 0)
    .slice(0, 50);
}

function normalizeColor(raw: unknown): string {
  const allowed = new Set(['sand', 'rose', 'sage', 'sky', 'amber', 'lavender', 'slate']);
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return allowed.has(value) ? value : 'sand';
}

function normalizeReminderDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeReminderLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function normalizeReminderTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed.slice(0, 5) : null;
}

function mapRow(row: RememberNoteRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color,
    checklist: normalizeChecklist(row.checklist),
    tags: normalizeTags(row.tags),
    reminder_date: row.reminder_date,
    reminder_time: row.reminder_time ? row.reminder_time.slice(0, 5) : null,
    reminder_label: row.reminder_label,
    reminder_repeat_daily: row.reminder_repeat_daily === true,
    reminder_sent_at: row.reminder_sent_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listRememberNotes(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const rows = await query<RememberNoteRow>(
    `SELECT id, title, body, color, checklist, tags, reminder_date::text, reminder_time::text, reminder_label, reminder_repeat_daily, reminder_sent_at::text, created_at, updated_at
     FROM remember_notes
     WHERE user_id = $1
     ORDER BY
       CASE WHEN reminder_date = CURRENT_DATE THEN 0 ELSE 1 END,
       reminder_date ASC NULLS LAST,
       updated_at DESC`,
    [userId],
  );

  res.json({ notes: rows.map(mapRow) });
}

export async function createRememberNote(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 5000) : '';
  const checklist = normalizeChecklist(req.body?.checklist);

  if (!title && !body && checklist.length === 0) {
    res.status(400).json({ error: 'A nota precisa ter título, texto ou checklist' });
    return;
  }

  const rows = await query<RememberNoteRow>(
    `INSERT INTO remember_notes (user_id, title, body, color, checklist, tags, reminder_date, reminder_time, reminder_label, reminder_repeat_daily, reminder_sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
     RETURNING id, title, body, color, checklist, tags, reminder_date::text, reminder_time::text, reminder_label, reminder_repeat_daily, reminder_sent_at::text, created_at, updated_at`,
    [
      userId,
      title,
      body,
      normalizeColor(req.body?.color),
      JSON.stringify(checklist),
      normalizeTags(req.body?.tags),
      normalizeReminderDate(req.body?.reminder_date),
      normalizeReminderTime(req.body?.reminder_time),
      normalizeReminderLabel(req.body?.reminder_label),
      req.body?.reminder_repeat_daily === true,
    ],
  );

  res.status(201).json(mapRow(rows[0]));
}

export async function updateRememberNote(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { id } = req.params;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 160) : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 5000) : '';
  const checklist = normalizeChecklist(req.body?.checklist);

  if (!title && !body && checklist.length === 0) {
    res.status(400).json({ error: 'A nota precisa ter título, texto ou checklist' });
    return;
  }

  const rows = await query<RememberNoteRow>(
    `UPDATE remember_notes
     SET title = $1,
         body = $2,
         color = $3,
         checklist = $4,
         tags = $5,
         reminder_date = $6,
         reminder_time = $7,
         reminder_label = $8,
         reminder_repeat_daily = $9,
         reminder_sent_at = CASE
           WHEN $6 IS DISTINCT FROM reminder_date
             OR $7 IS DISTINCT FROM reminder_time
             OR $8 IS DISTINCT FROM reminder_label
             OR $9 IS DISTINCT FROM reminder_repeat_daily THEN NULL
           ELSE reminder_sent_at
         END,
         updated_at = NOW()
     WHERE id = $10
       AND user_id = $11
     RETURNING id, title, body, color, checklist, tags, reminder_date::text, reminder_time::text, reminder_label, reminder_repeat_daily, reminder_sent_at::text, created_at, updated_at`,
    [
      title,
      body,
      normalizeColor(req.body?.color),
      JSON.stringify(checklist),
      normalizeTags(req.body?.tags),
      normalizeReminderDate(req.body?.reminder_date),
      normalizeReminderTime(req.body?.reminder_time),
      normalizeReminderLabel(req.body?.reminder_label),
      req.body?.reminder_repeat_daily === true,
      id,
      userId,
    ],
  );

  if (!rows.length) {
    res.status(404).json({ error: 'Nota não encontrada' });
    return;
  }

  res.json(mapRow(rows[0]));
}

export async function deleteRememberNote(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Usuário não autenticado' });
    return;
  }

  const { id } = req.params;
  const rows = await query<{ id: string }>(
    `DELETE FROM remember_notes
     WHERE id = $1
       AND user_id = $2
     RETURNING id`,
    [id, userId],
  );

  if (!rows.length) {
    res.status(404).json({ error: 'Nota não encontrada' });
    return;
  }

  res.json({ deleted: true });
}

function requireUserId(req: AuthRequest, res: Response): string | null {
  if (req.userId) return req.userId;
  res.status(401).json({ error: 'Usuário não autenticado' });
  return null;
}

export async function rememberStatus(req: AuthRequest, res: Response): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  res.json(await getRememberStatus(userId));
}

async function changeRecording(req: AuthRequest, res: Response, recording: boolean): Promise<void> {
  const userId = requireUserId(req, res);
  if (!userId) return;
  try {
    res.json(await setRememberRecording(userId, recording));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export async function startRemember(req: AuthRequest, res: Response): Promise<void> {
  await changeRecording(req, res, true);
}

export async function stopRemember(req: AuthRequest, res: Response): Promise<void> {
  await changeRecording(req, res, false);
}

export async function rememberYears(_req: AuthRequest, res: Response): Promise<void> {
  try { res.json({ years: await getRememberYears() }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberMonths(req: AuthRequest, res: Response): Promise<void> {
  try { res.json({ months: await getRememberMonths(Number(req.params.year)) }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberDays(req: AuthRequest, res: Response): Promise<void> {
  try { res.json({ days: await getRememberDays(Number(req.params.year), Number(req.params.month)) }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberDay(req: AuthRequest, res: Response): Promise<void> {
  const { date } = req.params as { date: string };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Data inválida' });
    return;
  }
  try { res.json(await getRememberDay(date)); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberSessions(req: AuthRequest, res: Response): Promise<void> {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Data inválida' });
    return;
  }
  try { res.json({ sessions: await getRememberSessions(date) }); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberTranscript(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId } = req.params as { sessionId: string };
  try { res.json(await getRememberTranscript(sessionId)); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberSearch(req: AuthRequest, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (q.trim().length < 2) {
    res.status(400).json({ error: 'Consulta muito curta' });
    return;
  }
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  const speaker = typeof req.query.speaker === 'string' ? req.query.speaker : undefined;
  try {
    res.json(await getRememberSearch(q, limit, speaker));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export async function rememberVoiceprintGet(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await getRememberVoiceprint()); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberVoiceprintPost(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: 'Áudio ausente' });
    return;
  }
  const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : 'application/octet-stream';
  try {
    res.status(201).json(await enrollRememberVoiceprint(body, contentType));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(error.statusCode === 400 ? 400 : 503).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export async function rememberVoiceprintDelete(req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await deleteRememberVoiceprint()); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Serviço de gravação offline' }); }
}

export async function rememberVoiceprintFromSession(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId } = req.params as { sessionId: string };
  try {
    res.status(201).json(await enrollRememberVoiceprintFromSession(sessionId));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503).json({ error: error.message });
      return;
    }
    throw error;
  }
}

export async function rememberSegmentsSpeaker(req: AuthRequest, res: Response): Promise<void> {
  const ids = Array.isArray(req.body?.segment_ids)
    ? req.body.segment_ids.filter((n: unknown): n is number => typeof n === 'number')
    : [];
  const speaker = req.body?.speaker ?? null;
  if (ids.length === 0) {
    res.status(400).json({ error: 'segment_ids obrigatório' });
    return;
  }
  if (speaker !== null && !['me', 'other', 'unknown'].includes(speaker)) {
    res.status(400).json({ error: 'speaker inválido' });
    return;
  }
  try {
    res.json(await setRememberSegmentsSpeaker(ids, speaker));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(error.statusCode === 400 ? 400 : 503).json({ error: error.message });
      return;
    }
    throw error;
  }
}

const CLUSTER_ACTIONS = ['confirm_new', 'confirm_person', 'reject', 'set_me'];

function celtwoStatus(error: CeltwoUnavailableError): number {
  return error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 503;
}

export async function rememberClusters(req: AuthRequest, res: Response): Promise<void> {
  const b = req.body ?? {};
  if (typeof b.session_id !== 'string' || typeof b.cluster !== 'number' || !CLUSTER_ACTIONS.includes(b.action)) {
    res.status(400).json({ error: 'session_id, cluster e action obrigatórios' });
    return;
  }
  const name = typeof b.name === 'string' ? b.name.trim() : undefined;
  const personId = typeof b.person_id === 'number' && Number.isInteger(b.person_id) ? b.person_id : undefined;
  if (b.action === 'confirm_person' && personId === undefined) {
    res.status(400).json({ error: 'person_id obrigatório para confirm_person' });
    return;
  }
  if (b.action === 'confirm_new' && !name) {
    res.status(400).json({ error: 'name obrigatório para confirm_new' });
    return;
  }
  try {
    res.json(await setRememberCluster({
      session_id: b.session_id, cluster: b.cluster, action: b.action,
      name,
      person_id: personId,
    }));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

export async function rememberPeople(_req: AuthRequest, res: Response): Promise<void> {
  try { res.json(await getRememberPeople()); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

export async function rememberPeopleRename(req: AuthRequest, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!Number.isInteger(id) || !name) { res.status(400).json({ error: 'id e name obrigatórios' }); return; }
  try { res.json(await renameRememberPerson(id, name)); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

export async function rememberPeopleMerge(req: AuthRequest, res: Response): Promise<void> {
  const into = req.body?.into_id, from = req.body?.from_id;
  const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  if (!isInt(into) || !isInt(from)) { res.status(400).json({ error: 'into_id e from_id obrigatórios' }); return; }
  if (into === from) { res.status(400).json({ error: 'into_id e from_id não podem ser iguais' }); return; }
  try { res.json(await mergeRememberPeople(into, from)); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

export async function rememberPeopleDelete(req: AuthRequest, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'id inválido' }); return; }
  try { res.json(await deleteRememberPerson(id)); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

export async function rememberSegmentAudio(req: AuthRequest, res: Response): Promise<void> {
  const rawIds = typeof req.query.ids === 'string' ? req.query.ids : null;
  try {
    let upstream: Awaited<ReturnType<typeof getRememberSegmentAudio>>;
    if (rawIds !== null) {
      const ids = rawIds.split(',').filter(Boolean).map(Number);
      if (!ids.length || ids.length > 10 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        res.status(400).json({ error: 'ids inválidos' });
        return;
      }
      upstream = await getRememberClusterSampleAudio(ids);
    } else {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) { res.status(400).json({ error: 'id inválido' }); return; }
      upstream = await getRememberSegmentAudio(id);
    }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') ?? 'audio/wav';
    res.set('Content-Type', ct.startsWith('audio/') ? ct : 'audio/wav');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) {
      res.status(celtwoStatus(error)).json({ error: error.message });
      return;
    }
    logError('remember.segment.audio.error', { detail: String(error) });
    if (!res.headersSent) res.status(502).json({ error: 'Falha ao ler o áudio' });
  }
}

export async function rememberBackfillSpeakers(req: AuthRequest, res: Response): Promise<void> {
  const { sessionId } = req.params as { sessionId: string };
  if (!sessionId) { res.status(400).json({ error: 'sessionId obrigatório' }); return; }
  try { res.json(await backfillRememberSpeakers(sessionId)); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError) { res.status(celtwoStatus(error)).json({ error: error.message }); return; }
    throw error;
  }
}

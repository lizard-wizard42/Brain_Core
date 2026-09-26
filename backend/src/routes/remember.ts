import { createHash } from 'crypto';
import { Router, raw } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { ownerOnly } from '../middleware/ownerOnly';
import { celtwoRequest, CeltwoUnavailableError } from '../remember/celtwoClient';
import { ownedSessionIds } from '../remember/ownership';
import { participants } from '../remember/service';
import { getAudioRetention, putAudioRetention, previewAudioRetention, cleanAudioRetention } from './audioRetention';
import { getTranscriptionPolicy, putTranscriptionPolicy, runTranscriptionNow, pauseTranscription } from './transcriptionPolicy';
import {
  createRememberNote,
  deleteRememberNote,
  listRememberNotes,
  updateRememberNote,
  rememberDay,
  rememberDays,
  rememberMonths,
  rememberStatus,
  rememberYears,
  startRemember,
  stopRemember,
  rememberSessions,
  rememberTranscript,
  rememberSearch,
  rememberVoiceprintGet,
  rememberVoiceprintPost,
  rememberVoiceprintDelete,
  rememberVoiceprintFromSession,
} from '../controllers/rememberController';

const router = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

router.post('/memory/browser/chunks', raw({ type: ['audio/webm', 'audio/ogg'], limit: '32mb' }), async (req: AuthRequest, res) => {
  if (req.query.owner_user_id !== req.userId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' });
    return;
  }
  const sessionId = String(req.query.session_id || '');
  const chunkNum = Number(req.query.chunk_num);
  const startedAt = String(req.query.started_at || '');
  const chunkStartedAt = String(req.query.chunk_started_at || '');
  const audio = req.body;
  if (!uuidPattern.test(sessionId) || !Number.isInteger(chunkNum) || chunkNum < 1 || chunkNum > 99999
    || !isoPattern.test(startedAt) || Number.isNaN(Date.parse(startedAt))
    || (chunkStartedAt && (!isoPattern.test(chunkStartedAt) || Number.isNaN(Date.parse(chunkStartedAt))))
    || !Buffer.isBuffer(audio) || audio.length === 0 || !['audio/webm', 'audio/ogg'].includes(req.headers['content-type']?.split(';')[0] || '')) {
    res.status(400).json({ error: 'Bloco de áudio inválido' });
    return;
  }
  try {
    await query(
      `INSERT INTO browser_recording_sessions (session_id, user_id, started_at)
       VALUES ($1, $2, $3::timestamptz) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, req.userId, startedAt],
    );
    const owner = await query<{ user_id: string }>(
      'SELECT user_id FROM browser_recording_sessions WHERE session_id = $1', [sessionId],
    );
    if (owner[0]?.user_id !== req.userId) { res.status(409).json({ error: 'Sessão pertence a outro usuário' }); return; }
    const digest = createHash('sha256').update(audio).digest('hex');
    const params = new URLSearchParams({
      session_id: sessionId, chunk_num: String(chunkNum), device_id: `browser-${req.userId}`,
      sha256: digest, started_at: startedAt,
      ...(chunkStartedAt ? { chunk_started_at: chunkStartedAt } : {}),
      owner_user_id: req.userId!,
    });
    const result = await celtwoRequest<{ sha256: string; status: string }>(`/api/v1/chunks?${params}`, {
      method: 'POST', body: new Uint8Array(audio),
      headers: { 'Content-Type': req.headers['content-type'] || 'audio/webm' },
    });
    if (result.sha256 !== digest || !['stored', 'already_stored'].includes(result.status)) throw new Error('Confirmação inválida do áudio');
    res.json({ sha256: digest, status: result.status });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Falha ao salvar áudio' });
  }
});

router.post('/memory/browser/sessions/:sessionId/claim', async (req: AuthRequest, res) => {
  if (req.query.owner_user_id !== req.userId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' }); return;
  }
  const startedAt = String(req.query.started_at || '');
  if (!uuidPattern.test(String(req.params.sessionId)) || !isoPattern.test(startedAt) || Number.isNaN(Date.parse(startedAt))) {
    res.status(400).json({ error: 'Sessão inválida' }); return;
  }
  try {
    await query(
      `INSERT INTO browser_recording_sessions (session_id, user_id, started_at)
       VALUES ($1, $2, $3::timestamptz) ON CONFLICT (session_id) DO NOTHING`,
      [String(req.params.sessionId), req.userId, startedAt],
    );
    const owner = await query<{ user_id: string }>(
      'SELECT user_id FROM browser_recording_sessions WHERE session_id = $1', [String(req.params.sessionId)],
    );
    if (owner[0]?.user_id !== req.userId) {
      res.status(409).json({ error: 'Sessão pertence a outra conta' }); return;
    }
    res.json({ claimed: true });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Falha ao atribuir gravação' });
  }
});

router.post('/memory/browser/sessions/:sessionId/complete', async (req: AuthRequest, res) => {
  if (req.query.owner_user_id !== req.userId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' });
    return;
  }
  if (!uuidPattern.test(String(req.params.sessionId))) { res.status(400).json({ error: 'Sessão inválida' }); return; }
  try {
    const owner = await query<{ user_id: string }>(
      'SELECT user_id FROM browser_recording_sessions WHERE session_id = $1', [String(req.params.sessionId)],
    );
    if (owner[0]?.user_id !== req.userId) { res.status(404).json({ error: 'Sessão não encontrada' }); return; }
    await celtwoRequest(`/api/v1/sessions/${String(req.params.sessionId)}/complete`, {
      method: 'POST', body: JSON.stringify({ status: 'stopped' }),
    });
    await query('UPDATE browser_recording_sessions SET completed_at = NOW() WHERE session_id = $1', [String(req.params.sessionId)]);
    res.json({ status: 'processing' });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Falha ao concluir gravação' });
  }
});

router.get('/memory/status', rememberStatus);
router.post('/memory/start', ownerOnly, startRemember);
router.post('/memory/stop', ownerOnly, stopRemember);
router.get('/memory/years', rememberYears);
router.get('/memory/years/:year/months', rememberMonths);
router.get('/memory/years/:year/months/:month/days', rememberDays);
router.get('/memory/days/:date', rememberDay);
router.get('/memory/sessions', rememberSessions);
router.get('/memory/sessions/:sessionId/transcript', rememberTranscript);
router.get('/memory/search', rememberSearch);
router.get('/memory/voiceprint', rememberVoiceprintGet);
router.post('/memory/voiceprint', raw({ type: () => true, limit: '25mb' }), rememberVoiceprintPost);
router.delete('/memory/voiceprint', rememberVoiceprintDelete);
router.post('/memory/voiceprint/from-session/:sessionId', rememberVoiceprintFromSession);
router.use('/memory/sessions/:sessionId/participants', async (req: AuthRequest, res, next) => {
  try {
    if (!(await ownedSessionIds(req.userId!)).has(String(req.params.sessionId))) { res.status(404).json({ error: 'Sessão não encontrada' }); return; }
    next();
  } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'Falha de acesso' }); }
});
const segmentId = (rawId: string) => { const value = Number(rawId); return Number.isSafeInteger(value) && value > 0 ? value : null; };
const participantError = (error: unknown, res: import('express').Response) => {
  const status = error instanceof CeltwoUnavailableError ? error.statusCode : undefined;
  res.status(status === 400 || status === 404 ? status : 503).json({ error: error instanceof Error ? error.message : 'Celtwo offline' });
};
router.get('/memory/sessions/:sessionId/participants/identities', async (req: AuthRequest, res) => {
  try { res.json(await participants.list(req.userId!)); } catch (error) { participantError(error, res); }
});
router.post('/memory/sessions/:sessionId/participants/identities', async (req: AuthRequest, res) => {
  const name = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
  if (!name || name.length > 40) { res.status(400).json({ error: 'Nome inválido' }); return; }
  try { res.status(201).json(await participants.create(req.userId!, name)); } catch (error) { participantError(error, res); }
});
router.get('/memory/sessions/:sessionId/participants/segments/:segmentId', async (req: AuthRequest, res) => {
  const id = segmentId(String(req.params.segmentId));
  if (!id) { res.status(400).json({ error: 'Segmento inválido' }); return; }
  try { res.json({ decision: await participants.decision(req.userId!, String(req.params.sessionId), id), suggestions: await participants.suggestions(req.userId!, String(req.params.sessionId), id) }); }
  catch (error) { participantError(error, res); }
});
router.post('/memory/sessions/:sessionId/participants/segments/:segmentId/decision', async (req: AuthRequest, res) => {
  const id = segmentId(String(req.params.segmentId));
  const action = req.body?.action;
  const identityId = req.body?.identity_id ?? null;
  if (!id || !['confirm', 'correct', 'ignore', 'undo'].includes(action) || (identityId !== null && typeof identityId !== 'string')) {
    res.status(400).json({ error: 'Decisão inválida' }); return;
  }
  try { res.json(await participants.decide(req.userId!, String(req.params.sessionId), id, action, identityId)); }
  catch (error) { participantError(error, res); }
});
router.post('/memory/sessions/:sessionId/participants/segments/:segmentId/template', async (req: AuthRequest, res) => {
  const id = segmentId(String(req.params.segmentId));
  if (!id) { res.status(400).json({ error: 'Segmento inválido' }); return; }
  try { res.status(201).json(await participants.createTemplate(req.userId!, String(req.params.sessionId), id)); }
  catch (error) { participantError(error, res); }
});
router.get('/audio-retention', getAudioRetention);
router.put('/audio-retention', putAudioRetention);
router.get('/audio-retention/preview', previewAudioRetention);
router.post('/audio-retention/cleanup', cleanAudioRetention);
router.get('/transcription-policy', getTranscriptionPolicy);
router.put('/transcription-policy', putTranscriptionPolicy);
router.post('/transcription-policy/run', runTranscriptionNow);
router.post('/transcription-policy/pause', pauseTranscription);

router.get('/', listRememberNotes);
router.post('/', createRememberNote);
router.patch('/:id', updateRememberNote);
router.delete('/:id', deleteRememberNote);

export default router;

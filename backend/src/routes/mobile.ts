import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Router, Request, Response, NextFunction, raw } from 'express';
import { config } from '../config';
import { query } from '../config/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { createRememberNote } from '../controllers/rememberController';
import { getAudioRetention, putAudioRetention, previewAudioRetention, cleanAudioRetention } from './audioRetention';
import { getTranscriptionPolicy, putTranscriptionPolicy, runTranscriptionNow, pauseTranscription } from './transcriptionPolicy';
import { participants } from '../remember/service';

const router = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shaPattern = /^[0-9a-f]{64}$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

interface DeviceRequest extends Request {
  mobileUserId?: string;
  mobileDeviceId?: string;
}

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function sameHash(left: string, right: string): boolean {
  if (!shaPattern.test(left) || !shaPattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

async function authenticateDevice(req: DeviceRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer bcmd_') ? header.slice(7) : '';
  if (!/^bcmd_[A-Za-z0-9_-]{43}$/.test(token)) {
    res.status(401).json({ error: 'Dispositivo não vinculado' });
    return;
  }
  try {
    const rows = await query<{ id: string; user_id: string }>(
      `SELECT d.id, d.user_id FROM mobile_devices d
       JOIN users u ON u.id::text = d.user_id
       WHERE d.token_hash = $1 AND d.revoked_at IS NULL AND d.session_version = u.session_version`,
      [sha256(token)],
    );
    if (!rows.length) {
      res.status(401).json({ error: 'Credencial revogada ou inválida' });
      return;
    }
    req.mobileDeviceId = rows[0].id;
    req.mobileUserId = rows[0].user_id;
    await query('UPDATE mobile_devices SET last_used_at = NOW() WHERE id = $1', [rows[0].id]);
    next();
  } catch { unavailable(res); }
}

async function memoryRequest(path: string, init: RequestInit): Promise<globalThis.Response> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy' || !config.CELTWO_MEMORY_URL || !config.CELTWO_MEMORY_TOKEN) {
    throw new Error('memory_offline');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.CELTWO_MEMORY_UPLOAD_TIMEOUT_MS);
  try {
    return await fetch(`${config.CELTWO_MEMORY_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.CELTWO_MEMORY_TOKEN}`,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function unavailable(res: Response): void {
  res.status(503).json({ error: 'Serviço de memória indisponível; o app tentará novamente' });
}

router.post('/devices', authMiddleware, async (req: AuthRequest, res: Response) => {
  // The native app exchanges the existing WebView login for a scoped device token.
  // The custom header forces a browser CORS preflight for cross-origin requests.
  const requestOrigin = req.headers.origin;
  if (!requestOrigin || !config.CORS_ORIGINS.includes(requestOrigin)
    || req.headers['x-brain-core-device'] !== 'android') {
    res.status(403).json({ error: 'Vinculação permitida apenas pela origem configurada' });
    return;
  }
  const userId = req.userId!;
  if (req.body?.expected_user_id && req.body.expected_user_id !== userId) {
    res.status(403).json({ error: 'Sessão web ativa não corresponde à conta informada' });
    return;
  }
  if (req.body?.previous_user_id && req.body.previous_user_id !== userId && !req.body?.confirm_switch) {
    res.status(409).json({ error: 'Troca de conta requer confirmação explícita' });
    return;
  }
  const active = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM mobile_devices WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  if (Number(active[0].count) >= 10) {
    res.status(409).json({ error: 'Limite de dispositivos atingido; revogue um dispositivo antigo' });
    return;
  }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : 'Android';
  const token = `bcmd_${randomBytes(32).toString('base64url')}`;
  const rows = await query<DeviceRow>(
    `INSERT INTO mobile_devices (user_id, name, token_hash, session_version)
     SELECT id, $2, $3, session_version FROM users WHERE id = $1
     RETURNING id, user_id, name, created_at, last_used_at`,
    [userId, name || 'Android', sha256(token)],
  );
  if (!rows.length) { res.status(401).json({ error: 'Usuário não encontrado' }); return; }
  res.status(201).json({ device_id: rows[0].id, user_id: rows[0].user_id, token });
});

router.get('/devices', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rows = await query<DeviceRow>(
    `SELECT id, user_id, name, created_at, last_used_at FROM mobile_devices
     WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
    [req.userId],
  );
  res.json({ devices: rows.map(({ id, name, created_at, last_used_at }) => ({ id, name, created_at, last_used_at })) });
});

router.delete('/devices/:deviceId', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!uuidPattern.test(String(req.params.deviceId))) { res.status(400).json({ error: 'ID inválido' }); return; }
  const rows = await query<{ id: string }>(
    `UPDATE mobile_devices SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [String(req.params.deviceId), req.userId],
  );
  if (!rows.length) { res.status(404).json({ error: 'Dispositivo não encontrado' }); return; }
  res.json({ revoked: true });
});

router.get('/device', authenticateDevice, (req: DeviceRequest, res: Response) => {
  res.json({ device_id: req.mobileDeviceId, user_id: req.mobileUserId });
});

router.post('/notes', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  (req as AuthRequest).userId = req.mobileUserId;
  try { await createRememberNote(req as AuthRequest, res); } catch { unavailable(res); }
});

function asAccount(req: DeviceRequest): AuthRequest {
  (req as AuthRequest).userId = req.mobileUserId;
  return req as AuthRequest;
}

router.get('/audio-retention', authenticateDevice, (req: DeviceRequest, res: Response) => getAudioRetention(asAccount(req), res));
router.put('/audio-retention', authenticateDevice, (req: DeviceRequest, res: Response) => putAudioRetention(asAccount(req), res));
router.get('/audio-retention/preview', authenticateDevice, (req: DeviceRequest, res: Response) => previewAudioRetention(asAccount(req), res));
router.post('/audio-retention/cleanup', authenticateDevice, (req: DeviceRequest, res: Response) => cleanAudioRetention(asAccount(req), res));
router.get('/transcription-policy', authenticateDevice, (req: DeviceRequest, res: Response) => getTranscriptionPolicy(asAccount(req), res));
router.put('/transcription-policy', authenticateDevice, (req: DeviceRequest, res: Response) => putTranscriptionPolicy(asAccount(req), res));
router.post('/transcription-policy/run', authenticateDevice, (req: DeviceRequest, res: Response) => runTranscriptionNow(asAccount(req), res));
router.post('/transcription-policy/pause', authenticateDevice, (req: DeviceRequest, res: Response) => pauseTranscription(asAccount(req), res));

router.post('/sessions/owned', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  const sessionIds = req.body?.session_ids;
  if (!Array.isArray(sessionIds) || sessionIds.length > 100 || !sessionIds.every((id) => typeof id === 'string' && uuidPattern.test(id))) {
    res.status(400).json({ error: 'IDs de sessão inválidos' }); return;
  }
  try {
    const rows = await query<{ session_id: string }>(
      'SELECT session_id::text FROM mobile_sessions WHERE user_id = $1 AND device_id = $2 AND session_id = ANY($3::uuid[])',
      [req.mobileUserId, req.mobileDeviceId, sessionIds],
    );
    res.json({ session_ids: rows.map((row) => row.session_id) });
  } catch { unavailable(res); }
});

router.delete('/device', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  await query('UPDATE mobile_devices SET revoked_at = NOW() WHERE id = $1', [req.mobileDeviceId]);
  res.json({ revoked: true });
});

router.post('/chunks', authenticateDevice, raw({ type: ['audio/mp4', 'audio/m4a'], limit: '32mb' }), async (req: DeviceRequest, res: Response) => {
  if (req.query.owner_user_id !== req.mobileUserId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' });
    return;
  }
  const sessionId = String(req.query.session_id || '');
  const chunkNum = Number(req.query.chunk_num);
  const expectedSha = String(req.query.sha256 || '');
  const startedAt = String(req.query.started_at || '');
  const chunkStartedAt = String(req.query.chunk_started_at || '');
  if (!uuidPattern.test(sessionId) || !Number.isInteger(chunkNum) || chunkNum < 1 || chunkNum > 99999
    || !shaPattern.test(expectedSha) || !isoPattern.test(startedAt) || Number.isNaN(Date.parse(startedAt))
    || (chunkStartedAt && (!isoPattern.test(chunkStartedAt) || Number.isNaN(Date.parse(chunkStartedAt))))) {
    res.status(400).json({ error: 'Metadados de áudio inválidos' });
    return;
  }
  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length === 0 || !sameHash(sha256(audio), expectedSha)) {
    res.status(400).json({ error: 'SHA-256 do áudio não confere' });
    return;
  }
  try {
    await query(
      `INSERT INTO mobile_sessions (session_id, user_id, device_id, started_at)
       VALUES ($1, $2, $3, $4::timestamptz) ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, req.mobileUserId, req.mobileDeviceId, startedAt],
    );
    const owner = await query<{ user_id: string; device_id: string }>(
      'SELECT user_id, device_id FROM mobile_sessions WHERE session_id = $1', [sessionId],
    );
    if (owner[0]?.user_id !== req.mobileUserId || owner[0]?.device_id !== req.mobileDeviceId) {
      res.status(409).json({ error: 'Sessão pertence a outra conta ou aparelho' });
      return;
    }
    const params = new URLSearchParams({
      session_id: sessionId,
      chunk_num: String(chunkNum),
      device_id: `android-${req.mobileDeviceId}`,
      sha256: expectedSha,
      started_at: startedAt,
      ...(chunkStartedAt ? { chunk_started_at: chunkStartedAt } : {}),
      owner_user_id: req.mobileUserId!,
    });
    const upstream = await memoryRequest(`/api/v1/chunks?${params}`, {
      method: 'POST', headers: { 'Content-Type': 'audio/mp4' }, body: new Uint8Array(audio),
    });
    if (upstream.status === 200 || upstream.status === 201) {
      const result = await upstream.json() as { sha256?: string; status?: string };
      if (result.sha256 !== expectedSha || !['stored', 'already_stored'].includes(result.status || '')) {
        unavailable(res);
        return;
      }
      res.status(upstream.status).json(result);
    } else if (upstream.status === 409) {
      res.status(409).json({ error: 'Bloco divergente no servidor; não será sobrescrito' });
    } else {
      unavailable(res);
    }
  } catch { unavailable(res); }
});

async function ownedSession(req: DeviceRequest, res: Response): Promise<boolean> {
  if (!uuidPattern.test(String(req.params.sessionId))) {
    res.status(400).json({ error: 'ID de sessão inválido' }); return false;
  }
  const rows = await query<{ session_id: string }>(
    'SELECT session_id FROM mobile_sessions WHERE session_id = $1 AND user_id = $2 AND device_id = $3',
    [String(req.params.sessionId), req.mobileUserId, req.mobileDeviceId],
  );
  if (!rows.length) { res.status(404).json({ error: 'Sessão não encontrada' }); return false; }
  return true;
}

router.post('/sessions/:sessionId/complete', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  if (req.query.owner_user_id !== req.mobileUserId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' });
    return;
  }
  try {
    if (!await ownedSession(req, res)) return;
    const status = req.body?.status;
    if (status !== 'stopped' && status !== 'failed') { res.status(400).json({ error: 'Status inválido' }); return; }
    const upstream = await memoryRequest(`/api/v1/sessions/${String(req.params.sessionId)}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    if (!upstream.ok) { unavailable(res); return; }
    res.json(await upstream.json());
  } catch { unavailable(res); }
});

router.get('/sessions/:sessionId/transcript', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  if (req.query.owner_user_id !== req.mobileUserId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' });
    return;
  }
  try {
    if (!await ownedSession(req, res)) return;
    const upstream = await memoryRequest(`/sessions/${String(req.params.sessionId)}/transcript?owner_user_id=${encodeURIComponent(req.mobileUserId!)}`, { method: 'GET' });
    if (!upstream.ok) { unavailable(res); return; }
    res.json(await upstream.json());
  } catch { unavailable(res); }
});

async function ownedParticipantSession(req: DeviceRequest, res: Response): Promise<boolean> {
  if (req.query.owner_user_id !== req.mobileUserId) {
    res.status(409).json({ error: 'Gravação pertence a outra conta' }); return false;
  }
  return ownedSession(req, res);
}

const validSegmentId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

router.get('/sessions/:sessionId/participants/identities', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  try {
    if (!await ownedParticipantSession(req, res)) return;
    res.json({ identities: await participants.list(req.mobileUserId!) });
  } catch { unavailable(res); }
});

router.get('/sessions/:sessionId/participants/segments/:segmentId', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  const id = validSegmentId(String(req.params.segmentId));
  if (!id) { res.status(400).json({ error: 'Segmento inválido' }); return; }
  try {
    if (!await ownedParticipantSession(req, res)) return;
    res.json({
      decision: await participants.decision(req.mobileUserId!, String(req.params.sessionId), id),
      suggestions: await participants.suggestions(req.mobileUserId!, String(req.params.sessionId), id),
    });
  } catch { unavailable(res); }
});

router.post('/sessions/:sessionId/participants/segments/:segmentId/decision', authenticateDevice, async (req: DeviceRequest, res: Response) => {
  const id = validSegmentId(String(req.params.segmentId));
  const action = req.body?.action;
  const identityId = req.body?.identity_id ?? null;
  if (!id || !['confirm', 'correct', 'ignore', 'undo'].includes(action) ||
      (identityId !== null && (typeof identityId !== 'string' || !uuidPattern.test(identityId))) ||
      (['confirm', 'correct'].includes(action) && identityId === null)) {
    res.status(400).json({ error: 'Decisão inválida' }); return;
  }
  try {
    if (!await ownedParticipantSession(req, res)) return;
    res.json(await participants.decide(req.mobileUserId!, String(req.params.sessionId), id, action, identityId));
  } catch { unavailable(res); }
});

export default router;

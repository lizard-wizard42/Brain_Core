import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import path from 'path';
import { query } from '../config/database';
import { config } from '../config';
import { AuthRequest } from '../middleware/auth';
import { perUserRateLimit } from '../middleware/rateLimit';

const router = Router();
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allScopes = ['pages:read', 'pages:write', 'notes:read', 'notes:write'];
const tokenFields = `id, name, scopes, expires_at, revoked_at, created_at,
  (revoked_at IS NULL AND expires_at > NOW() AND session_version =
    (SELECT session_version FROM users WHERE id = integration_tokens.user_id)) AS valid`;

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  // Cookies must not authorize a cross-origin credential-management request.
  if (req.method !== 'GET' && req.headers.origin && !config.CORS_ORIGINS.includes(req.headers.origin)) {
    res.status(403).json({ error: 'Origem não autorizada' }); return;
  }
  next();
});
router.use(perUserRateLimit({ burst: 20, ratePerMin: 30 }));

async function ensureSettings(user: string) {
  await query('INSERT INTO integration_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user]);
}
router.get('/mcp', async (req: AuthRequest, res) => {
  try {
    await ensureSettings(req.userId!);
    const [settings, tokens, audit] = await Promise.all([
      query<{ enabled: boolean }>('SELECT enabled FROM integration_settings WHERE user_id = $1', [req.userId]),
      query(`SELECT ${tokenFields} FROM integration_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.userId]),
      query(`SELECT a.id, a.operation, a.target_kind, a.target_id, a.created_at, t.name AS credential_name
        FROM integration_audit a LEFT JOIN integration_tokens t ON t.id = a.token_id
        WHERE a.user_id = $1 ORDER BY a.created_at DESC, a.id LIMIT 30`, [req.userId]),
    ]);
    res.json({ enabled: settings[0].enabled, tokens, audit, connection: {
      server_path: path.resolve(__dirname, '../../../mcp/src/server.mjs'),
      backend_url: `http://127.0.0.1:${config.PORT}`,
    } });
  } catch { res.status(503).json({ error: 'Não foi possível consultar o MCP' }); }
});
router.put('/mcp', async (req: AuthRequest, res) => {
  if (!req.body || typeof req.body.enabled !== 'boolean' || Object.keys(req.body).some(k => k !== 'enabled')) {
    res.status(400).json({ error: 'Informe se o MCP deve ficar ligado' }); return;
  }
  try {
    await ensureSettings(req.userId!);
    await query('UPDATE integration_settings SET enabled = $2, updated_at = NOW() WHERE user_id = $1', [req.userId, req.body.enabled]);
    res.json({ enabled: req.body.enabled });
  } catch { res.status(503).json({ error: 'Não foi possível alterar o MCP' }); }
});
router.post('/mcp/tokens', async (req: AuthRequest, res) => {
  const { name, scopes, expires_in_days: days } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || ![1, 7, 30, 90].includes(days) ||
    !Array.isArray(scopes) || !scopes.length || scopes.some(s => !allScopes.includes(s)) ||
    new Set(scopes).size !== scopes.length ||
    ['pages', 'notes'].some(kind => scopes.includes(`${kind}:write`) && !scopes.includes(`${kind}:read`)) ||
    Object.keys(req.body).some(k => !['name', 'scopes', 'expires_in_days'].includes(k))) {
    res.status(400).json({ error: 'Nome, permissões ou validade inválidos' }); return;
  }
  try {
    await ensureSettings(req.userId!);
    const secret = `bc_${randomBytes(32).toString('base64url')}`;
    const rows = await query(`INSERT INTO integration_tokens (user_id,name,token_hash,session_version,scopes,expires_at)
      SELECT u.id,$2,$3,u.session_version,$4,NOW() + make_interval(days => $5)
      FROM users u JOIN integration_settings s ON s.user_id = u.id
      WHERE u.id = $1 AND s.enabled = TRUE RETURNING id, name, scopes, expires_at, created_at`,
      [req.userId, name.trim(), createHash('sha256').update(secret).digest('hex'), scopes, days]);
    if (!rows.length) { res.status(409).json({ error: 'Ligue o MCP antes de criar uma credencial' }); return; }
    // Only this response contains the secret; list endpoints never return its hash.
    res.status(201).json({ credential: rows[0], secret });
  } catch { res.status(503).json({ error: 'Não foi possível criar a credencial' }); }
});
router.delete('/mcp/tokens', async (req: AuthRequest, res) => {
  try {
    const rows = await query(`UPDATE integration_tokens SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [req.userId]);
    res.json({ revoked: rows.length });
  } catch { res.status(503).json({ error: 'Não foi possível revogar as credenciais' }); }
});
router.delete('/mcp/tokens/:id', async (req: AuthRequest, res) => {
  if (!validId.test(String(req.params.id))) { res.status(400).json({ error: 'Credencial inválida' }); return; }
  try {
    const rows = await query(`UPDATE integration_tokens SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = $1 AND user_id = $2 RETURNING id`, [req.params.id, req.userId]);
    if (!rows.length) { res.status(404).json({ error: 'Credencial não encontrada' }); return; }
    res.json({ revoked: true });
  } catch { res.status(503).json({ error: 'Não foi possível revogar a credencial' }); }
});

export default router;

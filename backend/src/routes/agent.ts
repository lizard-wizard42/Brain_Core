import { Router, Request } from 'express';
import { createHash, randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { pool, query } from '../config/database';
import { PageConflict, PageMissing, savePageRevision } from '../services/pageAccess';

type Kind = 'pages' | 'notes';
type Token = { id: string; user_id: string; scopes: string[] };
type AgentRequest = Request & { integration?: Token; integrationHash?: string };
class AgentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenSql = `SELECT t.id, t.user_id, t.scopes FROM integration_tokens t
  JOIN users u ON u.id = t.user_id
  JOIN integration_settings s ON s.user_id = t.user_id AND s.enabled = TRUE
  WHERE t.token_hash = $1 AND t.revoked_at IS NULL
  AND t.expires_at > NOW() AND t.session_version = u.session_version`;
const fields = {
  pages: 'id, title, content, revision, created_at, updated_at',
  notes: 'id, title, body, revision, created_at, updated_at',
};
const tables = { pages: 'pages', notes: 'remember_notes' };
const owned = { pages: "owner_user_id = $1 AND deleted_at IS NULL AND type = 'note' AND is_section = FALSE",
  notes: 'user_id = $1' };

function validId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new AgentError(400, 'Invalid UUID');
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AgentError(400, 'Invalid revision');
  return Number(value);
}
function validDocument(value: unknown): boolean {
  const nodes = new Set(['doc','paragraph','text','heading','blockquote','codeBlock','hardBreak','bulletList',
    'orderedList','listItem','horizontalRule','table','tableRow','tableHeader','tableCell','taskList','taskItem',
    'image','subPageBlock','attachmentBlock']);
  const marks = new Set(['bold','italic','strike','code','highlight','textStyle','underline','link']);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const safeUrl = (url: unknown) => typeof url === 'string' && (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^\/(?!\/)/.test(url) || /^#/.test(url));
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 64 || !object(node) || typeof node.type !== 'string' || !nodes.has(node.type)) return false;
    if (node.attrs !== undefined && !object(node.attrs)) return false;
    if (node.type === 'text' && typeof node.text !== 'string') return false;
    if (node.marks !== undefined && (!Array.isArray(node.marks) || !node.marks.every(mark => object(mark) &&
      typeof mark.type === 'string' && marks.has(mark.type) && (mark.attrs === undefined || object(mark.attrs)) &&
      (mark.type !== 'link' || (object(mark.attrs) && safeUrl(mark.attrs.href)))))) return false;
    if (node.attrs && ['image','attachmentBlock'].includes(node.type)) {
      if (!safeUrl((node.attrs as Record<string, unknown>)[node.type === 'image' ? 'src' : 'url'])) return false;
    }
    return node.content === undefined || (Array.isArray(node.content) && node.content.every(child => visit(child, depth + 1)));
  };
  return object(value) && value.type === 'doc' && Array.isArray(value.content) && visit(value, 0) &&
    Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024;
}
function changesFor(kind: Kind, body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length > 160 || (kind === 'pages' && !body.title.trim())) {
      throw new AgentError(400, 'Invalid title (maximum 160 characters)');
    }
    result.title = body.title;
  }
  if (kind === 'notes' && body.body !== undefined) {
    if (typeof body.body !== 'string' || body.body.length > 5000) throw new AgentError(400, 'Invalid body (maximum 5000 characters)');
    result.body = body.body;
  }
  if (kind === 'pages' && body.content !== undefined) {
    if (!validDocument(body.content)) throw new AgentError(400, 'Invalid Tiptap document');
    result.content = body.content;
  }
  if (!Object.keys(result).length) throw new AgentError(400, 'No changes supplied');
  return result;
}
function publicRow(kind: Kind, row: Record<string, unknown>) {
  return Object.fromEntries(fields[kind].split(', ').map(key => [key, row[key]]));
}
async function getOwned(client: PoolClient, kind: Kind, user: string, id: string, lock = false) {
  const row = (await client.query<Record<string, unknown>>(
    `SELECT ${fields[kind]} FROM ${tables[kind]} WHERE ${owned[kind]} AND id = $2${lock ? ' FOR UPDATE' : ''}`,
    [user, id])).rows[0];
  if (!row) throw new AgentError(404, 'Note not found');
  return row;
}
function checkScope(token: Token, kind: Kind, write: boolean) {
  if (!token.scopes.includes(`${kind}:${write ? 'write' : 'read'}`)) throw new AgentError(403, 'Scope denied');
}

const router = Router();
// Login JWTs and cookies are deliberately not accepted here.
router.use(async (req: AgentRequest, res, next) => {
  try {
    const bearer = req.headers.authorization;
    if (!bearer || !/^Bearer bc_[A-Za-z0-9_-]{43}$/.test(bearer)) throw new AgentError(401, 'Integration credential required');
    req.integrationHash = hash(bearer.slice(7));
    req.integration = (await query<Token>(tokenSql, [req.integrationHash]))[0];
    if (!req.integration) throw new AgentError(401, 'Integration expired or revoked');
    next();
  } catch (error) {
    res.status(error instanceof AgentError ? error.status : 503).json({ error: error instanceof AgentError ? error.message : 'Integration unavailable' });
  }
});

router.post('/:kind/:action', async (req: AgentRequest, res) => {
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: 'Integration unavailable' }); return; }
  let transaction = false;
  try {
    const kind = String(req.params.kind) as Kind;
    const action = String(req.params.action);
    if (!['pages', 'notes'].includes(kind) || !['list', 'get', 'versions', 'create', 'update', 'restore'].includes(action)) {
      throw new AgentError(404, 'Tool not found');
    }
    const write = ['create', 'update', 'restore'].includes(action);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AgentError(400, 'Object required');
    const allowed: Record<string, string[]> = {
      list: ['query', 'limit', 'offset'], get: ['id'], versions: ['id', 'limit', 'offset'],
      create: ['operation_id', 'title', kind === 'pages' ? 'content' : 'body'],
      update: ['id', 'operation_id', 'expected_revision', 'title', kind === 'pages' ? 'content' : 'body'],
      restore: ['id', 'operation_id', 'expected_revision', 'saved_revision'],
    };
    if (Object.keys(body).some(key => !allowed[action].includes(key))) throw new AgentError(400, 'Unsupported field');
    let token = req.integration!;
    await client.query('BEGIN'); transaction = true;
    // Switching off and revocation serialize with every call, including reads.
    token = (await client.query<Token>(`${tokenSql} FOR SHARE OF t, u, s`, [req.integrationHash])).rows[0];
    if (!token) throw new AgentError(401, 'Integration disabled, expired or revoked');
    checkScope(token, kind, write);
    if (!write) {
      const limit = body.limit ?? 20;
      const offset = body.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) throw new AgentError(400, 'Invalid pagination');
      if (action === 'list') {
        const search = body.query ?? '';
        if (typeof search !== 'string' || search.length > 200) throw new AgentError(400, 'Invalid search');
        const textField = kind === 'pages' ? 'content::text' : 'body';
        // Lists expose titles and revisions; full content requires get.
        const rows = (await client.query(`SELECT id, title, revision, updated_at FROM ${tables[kind]}
          WHERE ${owned[kind]} AND (strpos(lower(title),lower($2)) > 0 OR strpos(lower(${textField}),lower($2)) > 0)
          ORDER BY updated_at DESC, id LIMIT $3 OFFSET $4`, [token.user_id, search, limit, offset])).rows;
        await client.query('COMMIT'); transaction = false;
        res.json({ items: rows, next_offset: rows.length === limit ? offset + limit : null }); return;
      }
      const id = validId(body.id);
      const row = await getOwned(client, kind, token.user_id, id);
      if (action === 'get') {
        await client.query('COMMIT'); transaction = false;
        res.json(row); return;
      }
      const rows = kind === 'pages'
        ? (await client.query(`SELECT page_revision AS revision, title, created_at FROM page_versions
          WHERE page_id = $1 AND page_revision IS NOT NULL ORDER BY page_revision DESC, id DESC LIMIT $2 OFFSET $3`, [id, limit, offset])).rows
        : (await client.query(`SELECT revision, title, created_at FROM remember_note_versions
          WHERE note_id = $1 ORDER BY revision DESC LIMIT $2 OFFSET $3`, [id, limit, offset])).rows;
      await client.query('COMMIT'); transaction = false;
      res.json({ items: rows, next_offset: rows.length === limit ? offset + limit : null }); return;
    }
    const operationId = validId(body.operation_id);
    const id = action === 'create' ? randomUUID() : validId(body.id);
    const expected = action === 'create' ? 0 : revision(body.expected_revision);
    const requestHash = hash(JSON.stringify([kind, action, Object.entries(body).sort(([a], [b]) => a.localeCompare(b))]));
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${token.id}:${operationId}`]);
    const previous = (await client.query(`SELECT request_hash, response FROM integration_operations
      WHERE token_id = $1 AND operation_id = $2`, [token.id, operationId])).rows[0];
    if (previous) {
      if (previous.request_hash !== requestHash) throw new AgentError(409, 'operation_id was already used for different input');
      await client.query('COMMIT'); transaction = false; res.json(previous.response); return;
    }
    let changes: Record<string, unknown>;
    if (action !== 'create') {
      const current = await getOwned(client, kind, token.user_id, id, true);
      if (Number(current.revision) !== expected) throw new AgentError(409, 'Revision conflict; read the current note before editing');
    }
    if (action === 'restore') {
      const saved = revision(body.saved_revision);
      const row = kind === 'pages'
        ? (await client.query('SELECT title, content FROM page_versions WHERE page_id = $1 AND page_revision = $2 ORDER BY created_at DESC LIMIT 1', [id, saved])).rows[0]
        : (await client.query('SELECT title, body FROM remember_note_versions WHERE note_id = $1 AND revision = $2', [id, saved])).rows[0];
      if (!row) throw new AgentError(404, 'Version not found');
      // Existing versions may predate current input limits; preserve them exactly.
      changes = row;
    } else { changes = changesFor(kind, body); }
    let updated: Record<string, unknown>;
    if (action === 'create') {
      if (kind === 'pages') {
        if (!changes.title) throw new AgentError(400, 'Title required');
        updated = (await client.query(`INSERT INTO pages (id, owner_user_id, title, slug, type, content)
          VALUES ($1,$2,$3,$4,'note',$5) RETURNING *`, [id, token.user_id, changes.title, id,
          JSON.stringify(changes.content ?? { type: 'doc', content: [] })])).rows[0];
        await client.query(`INSERT INTO page_versions (page_id,title,content,reason,content_hash,author_user_id,page_revision)
          VALUES ($1,$2,$3,'agent-create',$4,$5,$6)`, [id, updated.title, JSON.stringify(updated.content),
          hash(JSON.stringify([updated.title, updated.content])), token.user_id, updated.revision]);
      } else {
        if (!changes.title && !changes.body) throw new AgentError(400, 'Title or body required');
        updated = (await client.query(`INSERT INTO remember_notes (id,user_id,title,body)
          VALUES ($1,$2,$3,$4) RETURNING *`, [id, token.user_id, changes.title ?? '', changes.body ?? ''])).rows[0];
      }
    } else if (kind === 'pages') {
      updated = await savePageRevision(id, token.user_id, expected, changes, `agent-${action}`, client);
    } else {
      const entries = Object.entries(changes);
      updated = (await client.query(`UPDATE remember_notes SET ${entries.map(([key], i) => `${key} = $${i + 3}`).join(', ')}, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING *`, [id, token.user_id, ...entries.map(([, value]) => value)])).rows[0];
    }
    const response = publicRow(kind, updated);
    await client.query(`INSERT INTO integration_audit (token_id,user_id,operation,target_kind,target_id)
      VALUES ($1,$2,$3,$4,$5)`, [token.id, token.user_id, action, kind, id]);
    await client.query(`INSERT INTO integration_operations (token_id,operation_id,request_hash,response)
      VALUES ($1,$2,$3,$4)`, [token.id, operationId, requestHash, JSON.stringify(response)]);
    await client.query('COMMIT'); transaction = false;
    res.json(response);
  } catch (error) {
    if (transaction) await client.query('ROLLBACK');
    const status = error instanceof AgentError ? error.status : error instanceof PageConflict ? 409 : error instanceof PageMissing ? 404 : 500;
    res.status(status).json({ error: error instanceof AgentError ? error.message : status === 500 ? 'Integration unavailable' : 'Note unavailable or revision conflict' });
  } finally { client.release(); }
});

export default router;

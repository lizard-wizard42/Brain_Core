import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { coverImageFilter } from '../services/uploadSafety';
import path from 'path';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { canEdit, pageRole } from '../services/pageAccess';
import { notifyPageGrantChanged } from '../services/socketService';
import {
  getPage,
  createPage,
  savePage,
  patchPage,
  deletePage,
  uploadCover,
  removeCover,
  getSubPages,
  getReferences,
  getPageVersions,
  restorePageVersion,
  getTrash,
  restorePage,
  permanentDeletePage,
  emptyTrash,
} from '../controllers/pagesController';

// Use project root (two levels up from src/routes/) regardless of __dirname at runtime
const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: coverImageFilter });

const router = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireOwnedPage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId || !uuidPattern.test(String(req.params.id))) { res.status(404).json({ error: 'Page not found' }); return; }
  try {
    const rows = await query('SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2', [String(req.params.id), req.userId]);
    if (!rows.length) { res.status(404).json({ error: 'Page not found' }); return; }
    next();
  } catch { res.status(503).json({ error: 'Não foi possível verificar a página' }); }
}
async function requirePageRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId || !uuidPattern.test(String(req.params.id))) { res.status(404).json({ error: 'Page not found' }); return; }
  try {
    const role = await pageRole(String(req.params.id), req.userId);
    if (!role || (req.method !== 'GET' && !canEdit(role)) ||
      (req.path.includes('/versions') && role === 'viewer')) {
      res.status(404).json({ error: 'Page not found' }); return;
    }
    (req as AuthRequest & { pageRole?: string }).pageRole = role;
    next();
  } catch { res.status(503).json({ error: 'Não foi possível verificar a página' }); }
}

// Trash routes — must come before /:id to avoid conflict
router.get('/trash', getTrash);
router.delete('/trash', emptyTrash);
router.get('/shared', async (req: AuthRequest, res: Response) => {
  try {
    const sent = req.query.direction === 'sent';
    const rows = await query(`SELECT p.id, p.title, p.slug, p.type, p.icon, p.updated_at,
      p.revision, ${sent ? "'owner'" : 'g.role'} AS role,
      v.created_at AS last_edited_at, u.name AS last_editor
      ${sent ? 'FROM pages p' : 'FROM page_grants g JOIN pages p ON p.id = g.page_id'}
      LEFT JOIN LATERAL (SELECT author_user_id, created_at FROM page_versions
        WHERE page_id = p.id ORDER BY created_at DESC LIMIT 1) v ON TRUE
      LEFT JOIN users u ON u.id = v.author_user_id
      WHERE ${sent ? 'p.owner_user_id = $1 AND EXISTS (SELECT 1 FROM page_grants g WHERE g.page_id = p.id)' : 'g.user_id = $1'}
      AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`, [req.userId]);
    res.json(rows);
  } catch { res.status(503).json({ error: 'Failed to list shared pages' }); }
});
router.use('/:id', (req: AuthRequest, res, next) => {
  if (req.path.endsWith('/restore') && !req.path.includes('/versions') ||
      req.path.endsWith('/permanent') || req.method === 'DELETE' && !req.path.endsWith('/cover') ||
      req.path.endsWith('/cover') ||
      req.path.includes('/grants') || req.method === 'PATCH' &&
      Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_page_id')) return requireOwnedPage(req, res, next);
  return requirePageRole(req, res, next);
});
router.get('/:id/grants', async (req: AuthRequest, res) => {
  try { res.json(await query(`SELECT g.user_id, u.email, u.name, g.role, g.granted_at
    FROM page_grants g JOIN users u ON u.id = g.user_id WHERE g.page_id = $1 ORDER BY g.granted_at`, [String(req.params.id)])); }
  catch { res.status(503).json({ error: 'Failed to list grants' }); }
});
router.put('/:id/grants/:userId', async (req: AuthRequest, res) => {
  if (!uuidPattern.test(String(req.params.userId)) || !['editor', 'viewer'].includes(req.body?.role) || String(req.params.userId) === req.userId) {
    res.status(400).json({ error: 'Invalid grant' }); return;
  }
  try {
    const rows = await query(`INSERT INTO page_grants(page_id, user_id, role)
      SELECT $1, id, $3 FROM users WHERE id = $2
      ON CONFLICT(page_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING user_id, role`,
      [String(req.params.id), String(req.params.userId), req.body.role]);
    if (!rows.length) { res.status(400).json({ error: 'User not found' }); return; }
    // Sharing a folder cascades the grant to every descendant page of the same owner.
    const granted = await query<{ page_id: string }>(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
        UNION
        SELECT p.id FROM pages p JOIN descendants d ON p.parent_page_id = d.id
        WHERE p.owner_user_id = $2 AND p.deleted_at IS NULL
      )
      INSERT INTO page_grants(page_id, user_id, role)
      SELECT d.id, $3, $4 FROM descendants d
      ON CONFLICT(page_id, user_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING page_id`,
      [String(req.params.id), req.userId, String(req.params.userId), req.body.role]);
    for (const row of granted) notifyPageGrantChanged(row.page_id, String(req.params.userId));
    res.json(rows[0]);
  } catch { res.status(503).json({ error: 'Failed to grant access' }); }
});
router.delete('/:id/grants/:userId', async (req: AuthRequest, res) => {
  try {
    const rows = await query<{ page_id: string }>(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
        UNION
        SELECT p.id FROM pages p JOIN descendants d ON p.parent_page_id = d.id
        WHERE p.owner_user_id = $2 AND p.deleted_at IS NULL
      )
      DELETE FROM page_grants g USING descendants d WHERE g.page_id = d.id AND g.user_id = $3
      RETURNING page_id`,
      [String(req.params.id), req.userId, String(req.params.userId)]);
    for (const row of rows) notifyPageGrantChanged(row.page_id, String(req.params.userId));
    res.json({ revoked: true });
  } catch { res.status(503).json({ error: 'Failed to revoke access' }); }
});
router.post('/:id/restore', restorePage);
router.delete('/:id/permanent', permanentDeletePage);

router.get('/:id/subpages', getSubPages);
router.get('/:id/references', getReferences);
router.get('/:id/versions', getPageVersions);
router.post('/:id/versions/:versionId/restore', restorePageVersion);
router.get('/:id', getPage);
router.post('/', createPage);
router.put('/:id', savePage);
router.patch('/:id', patchPage);
router.delete('/:id', deletePage);
router.post('/:id/cover', upload.single('cover'), uploadCover);
router.delete('/:id/cover', removeCover);

export default router;

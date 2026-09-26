import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { pool, query } from '../config/database';
import { InfiniteDoc, Page, PageSummary, PageVersion, TiptapDoc, TiptapNode } from '../types';
import { AuthRequest } from '../middleware/auth';
import { logError, logInfo } from '../utils/logger';
import { recordUploadedAsset } from '../services/uploadOwnership';
import { savePageRevision, PageConflict, PageMissing, pageRole } from '../services/pageAccess';

/**
 * Propagates a page's title and/or icon change to all subPageBlock nodes
 * in other pages that reference pageId. Called after title/icon updates.
 */
export async function propagateSubPageBlockAttrs(
  pageId: string,
  title: string | null,
  icon: string | null
): Promise<void> {
  const source = await query<{ owner_user_id: string; title: string; icon: string | null }>(
    'SELECT owner_user_id, title, icon FROM pages WHERE id = $1 AND deleted_at IS NULL', [pageId],
  );
  if (!source.length) return;
  // If icon not provided, fetch it from the page itself so we always sync the latest
  let resolvedIcon = icon;
  let resolvedTitle = title;
  if (resolvedIcon === null || resolvedTitle === null) {
    if (resolvedTitle === null) resolvedTitle = source[0].title;
    if (resolvedIcon === null) resolvedIcon = source[0].icon ?? '';
  }

  // Find all pages whose content contains a subPageBlock referencing pageId
  const rows = await query<{ id: string; content: TiptapDoc }>(
    `SELECT id, content FROM pages
     WHERE deleted_at IS NULL
       AND owner_user_id = $3
       AND id != $1
       AND content::text LIKE '%subPageBlock%'
       AND content::text LIKE $2`,
    [pageId, `%${pageId}%`, source[0].owner_user_id]
  );

  for (const row of rows) {
    const doc = row.content;
    if (!doc?.content) continue;

    let changed = false;

    function updateNodes(nodes: TiptapNode[]): TiptapNode[] {
      return nodes.map(node => {
        if (node.type === 'subPageBlock' && node.attrs?.pageId === pageId) {
          changed = true;
          return {
            ...node,
            attrs: {
              ...node.attrs,
              ...(resolvedTitle !== null ? { title: resolvedTitle } : {}),
              ...(resolvedIcon !== null ? { icon: resolvedIcon } : {}),
            },
          };
        }
        if (node.content) {
          return { ...node, content: updateNodes(node.content) };
        }
        return node;
      });
    }

    const updatedContent = { ...doc, content: updateNodes(doc.content) };
    if (changed) {
      await query(
        `UPDATE pages SET content = $1 WHERE id = $2 AND owner_user_id = $3`,
        [JSON.stringify(updatedContent), row.id, source[0].owner_user_id]
      );
    }
  }
}

function extractPageIdFromHref(href: string): string | null {
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
  try {
    const u = new URL(href, 'http://local');
    const m = u.pathname.match(new RegExp(`/((?:brain/)?page)/(${uuid})(?:/)?$`, 'i'));
    if (m?.[2]) return m[2];
    return null;
  } catch {
    const m = href.match(new RegExp(`/(?:brain/)?page/(${uuid})(?:[/?#]|$)`, 'i'));
    return m?.[1] ?? null;
  }
}

function collectPageRefs(nodes: TiptapNode[], out: Set<string>) {
  for (const node of nodes) {
    if (node.type === 'subPageBlock') {
      const refId = typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : null;
      if (refId) out.add(refId);
    }

    // Links in regular text marks
    if (node.marks?.length) {
      for (const mark of node.marks) {
        if (mark.type !== 'link') continue;
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        const refId = href ? extractPageIdFromHref(href) : null;
        if (refId) out.add(refId);
      }
    }

    // Defensive: link-like attrs on custom nodes
    const hrefAttr = typeof node.attrs?.href === 'string' ? node.attrs.href : null;
    if (hrefAttr) {
      const refId = extractPageIdFromHref(hrefAttr);
      if (refId) out.add(refId);
    }

    if (node.content?.length) collectPageRefs(node.content, out);
  }
}

function hideSubpageLabels(content: TiptapDoc | InfiniteDoc): TiptapDoc | InfiniteDoc {
  const clean = JSON.parse(JSON.stringify(content));
  function scrub(nodes: TiptapNode[]) {
    for (const node of nodes) {
      if (node.type === 'subPageBlock') node.attrs = { pageId: null, title: 'Página privada', icon: '' };
      if (node.content) scrub(node.content);
    }
  }
  if (Array.isArray(clean?.content)) scrub(clean.content);
  return clean;
}

// Shared by GET/PUT/PATCH so every page response for a non-owner carries the
// same authorized field set.
function redactPageForRole<T extends Record<string, unknown>>(page: T, role: string | null): T {
  if (role === 'owner') return page;
  const clean = JSON.parse(JSON.stringify(page));
  delete clean.working_directory;
  delete clean.markdown_source;
  delete clean.owner_user_id;
  if (clean.content) clean.content = hideSubpageLabels(clean.content);
  return clean;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function isInfiniteDoc(content: unknown): content is InfiniteDoc {
  return typeof content === 'object'
    && content !== null
    && 'tldraw' in content
    && (content as { tldraw?: unknown }).tldraw === true;
}

function normalizeInfiniteContent(content: unknown): InfiniteDoc {
  if (isInfiniteDoc(content)) return content;
  return {
    tldraw: true,
    version: 1,
    data: null,
  };
}

function computeSnapshotHash(title: string, content: TiptapDoc | InfiniteDoc): string {
  return createHash('sha1').update(JSON.stringify({ title, content })).digest('hex');
}

export async function createVersionSnapshot(
  pageId: string,
  reason: string,
  explicit?: { title: string; content: TiptapDoc | InfiniteDoc }
): Promise<void> {
  let title = explicit?.title;
  let content = explicit?.content;

  if (!title || !content) {
    const rows = await query<{ title: string; content: TiptapDoc | InfiniteDoc }>(
      `SELECT title, content FROM pages WHERE id = $1 AND deleted_at IS NULL`,
      [pageId]
    );
    if (!rows.length) return;
    title = rows[0].title;
    content = rows[0].content;
  }

  const hash = computeSnapshotHash(title, content);
  const latest = await query<{ content_hash: string }>(
    `SELECT content_hash FROM page_versions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [pageId]
  );
  if (latest[0]?.content_hash === hash) return;

  await query(
    `INSERT INTO page_versions (page_id, title, content, reason, content_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [pageId, title, JSON.stringify(content), reason, hash]
  );
}

export async function getPage(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const rows = await query<Page>('SELECT * FROM pages WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    const page = rows[0];
    const role = await pageRole(id, (req as AuthRequest).userId!);
    if (!role) { res.status(404).json({ error: 'Page not found' }); return; }
    if (role !== 'owner') {
      // Embedded subpage labels and local working directories are private to
      // the owning account. A grant never implies access to descendants.
      res.json(redactPageForRole(page as unknown as Record<string, unknown>, role)); return;
    }

    if (page.type === 'infinite' && !isInfiniteDoc(page.content)) {
      const normalized = normalizeInfiniteContent(page.content);
      await query(
        `UPDATE pages SET content = $1 WHERE id = $2 AND deleted_at IS NULL`,
        [JSON.stringify(normalized), id]
      );
      res.json({ ...page, content: normalized });
      return;
    }

    res.json(page);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch page', detail: String(err) });
  }
}

export async function createPage(req: Request, res: Response): Promise<void> {
  const { parent_page_id, title, slug, type = 'note', content, sort_order = 0, status, due_date, tags } = req.body as Partial<Page>;
  if (!title || !slug) {
    res.status(400).json({ error: 'title and slug are required' });
    return;
  }
  
  let defaultContent: any = { type: 'doc', content: [] };
  if (type === 'infinite') {
    defaultContent = { tldraw: true, version: 1, data: null };
  }

  const normalizedTags = normalizeTags(tags);
  try {
    const ownerUserId = (req as AuthRequest).userId;
    if (!ownerUserId) { res.status(401).json({ error: 'Não autenticado' }); return; }
    if (parent_page_id) {
      const parent = await query('SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL',
        [parent_page_id, ownerUserId]);
      if (!parent.length) { res.status(404).json({ error: 'Página pai não encontrada' }); return; }
    }
    const client = await pool.connect();
    let rows: Page[];
    try {
      await client.query('BEGIN');
      rows = (await client.query<Page>(
      `INSERT INTO pages (parent_page_id, title, slug, type, content, sort_order, status, due_date, tags, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        parent_page_id ?? null,
        title,
        slug,
        type,
        JSON.stringify(content ?? defaultContent),
        sort_order,
        status ?? null,
        due_date ?? null,
        normalizedTags,
        ownerUserId,
      ]
      )).rows;
      await client.query(`INSERT INTO page_versions
        (page_id, title, content, reason, content_hash, author_user_id, page_revision)
        VALUES ($1, $2, $3, 'create', $4, $5, $6)`, [rows[0].id, rows[0].title,
        JSON.stringify(rows[0].content), computeSnapshotHash(rows[0].title, rows[0].content),
        ownerUserId, 0]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    logInfo('page.create', {
      pageId: rows[0].id,
      parentPageId: rows[0].parent_page_id,
      pageType: rows[0].type,
      title: rows[0].title,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    logError('page.create.error', {
      detail: String(err),
      parentPageId: parent_page_id ?? null,
      pageType: type,
      title,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to create page', detail: String(err) });
  }
}

export async function getSubPages(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
  const tag = typeof req.query.tag === 'string' && req.query.tag.trim() ? req.query.tag.trim() : null;
  const dueFrom = typeof req.query.due_from === 'string' && req.query.due_from.trim() ? req.query.due_from.trim() : null;
  const dueTo = typeof req.query.due_to === 'string' && req.query.due_to.trim() ? req.query.due_to.trim() : null;
  try {
    const rows = await query<Page>(
      `SELECT id, parent_page_id, title, slug, type, icon, tags, status, due_date, working_directory, sort_order, updated_at
       FROM pages
       WHERE parent_page_id = $1
         AND owner_user_id = $6
         AND deleted_at IS NULL
         AND ($2::text IS NULL OR status = $2::text)
         AND ($3::text IS NULL OR $3::text = ANY(tags))
         AND ($4::date IS NULL OR due_date >= $4::date)
         AND ($5::date IS NULL OR due_date <= $5::date)
       ORDER BY sort_order, title`,
      [id, status, tag, dueFrom, dueTo, (req as AuthRequest).userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sub-pages', detail: String(err) });
  }
}

export async function getReferences(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    if (await pageRole(id, (req as AuthRequest).userId!) !== 'owner') {
      res.json({ incoming: [], outgoing: [] }); return;
    }
    const current = await query<{ id: string; content: TiptapDoc }>(
      `SELECT id, content FROM pages WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!current.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const outgoingIds = new Set<string>();
    collectPageRefs(current[0].content?.content ?? [], outgoingIds);
    outgoingIds.delete(id);

    const incomingCandidates = await query<PageSummary & { content: TiptapDoc }>(
      `SELECT id, parent_page_id, title, slug, icon, tags, status, due_date, sort_order, updated_at, content
       FROM pages
       WHERE deleted_at IS NULL
         AND owner_user_id = $3
         AND id != $1
         AND content::text LIKE $2
       ORDER BY updated_at DESC`,
      [id, `%${id}%`, (req as AuthRequest).userId]
    );
    const incoming = incomingCandidates.filter(candidate => {
      const refs = new Set<string>();
      collectPageRefs(candidate.content?.content ?? [], refs);
      return refs.has(id);
    }).map(({ content, ...rest }) => rest);

    const outgoing = outgoingIds.size
      ? await query<PageSummary>(
        `SELECT id, parent_page_id, title, slug, icon, tags, status, due_date, sort_order, updated_at
         FROM pages
         WHERE deleted_at IS NULL
           AND owner_user_id = $2
           AND id = ANY($1::uuid[])
         ORDER BY title`,
        [[...outgoingIds], (req as AuthRequest).userId]
      )
      : [];

    res.json({ incoming, outgoing });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch references', detail: String(err) });
  }
}

export async function getPageVersions(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const rawLimit = Number(req.query.limit ?? 30);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 30;
  try {
    const role = await pageRole(id, (req as AuthRequest).userId!);
    if (!role || role === 'viewer') { res.status(404).json({ error: 'Page not found' }); return; }
    const rows = await query<PageVersion>(
      `SELECT v.id, v.page_id, v.title, v.content, v.reason, v.author_user_id,
              u.name AS author_name, v.page_revision, v.created_at
       FROM page_versions v LEFT JOIN users u ON u.id = v.author_user_id
       WHERE v.page_id = $1
       ORDER BY v.created_at DESC
       LIMIT $2`,
      [id, limit]
    );
    res.json({ versions: role === 'owner' ? rows : rows.map(version => ({
      ...version, content: hideSubpageLabels(version.content),
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch versions', detail: String(err) });
  }
}

export async function restorePageVersion(_req: Request, res: Response): Promise<void> {
  res.status(405).json({ error: 'Version restore unavailable' });
}

export async function savePage(req: Request, res: Response): Promise<void> {
  const { content, title, revision } = req.body;
  if (!content || !Number.isSafeInteger(revision)) {
    res.status(400).json({ error: 'content and revision are required' }); return;
  }
  try {
    const row = await savePageRevision(String(req.params.id), (req as AuthRequest).userId!, revision,
      { content, ...(title !== undefined ? { title } : {}) }, title !== undefined ? 'content+title' : 'content');
    if (title !== undefined) {
      // Best-effort sync of embedded subPageBlock labels; never fails the save.
      propagateSubPageBlockAttrs(row.id as string, null, null).catch(() => {});
    }
    const userId = (req as AuthRequest).userId!;
    res.json(redactPageForRole(row, await pageRole(String(req.params.id), userId)));
  } catch (error) {
    if (error instanceof PageConflict) res.status(409).json({ error: 'Page revision conflict' });
    else if (error instanceof PageMissing) res.status(404).json({ error: 'Page not found' });
    else res.status(503).json({ error: 'Failed to save page' });
  }
}

export async function patchPage(req: Request, res: Response): Promise<void> {
  const { revision, ...body } = req.body;
  if (!Number.isSafeInteger(revision)) { res.status(400).json({ error: 'revision is required' }); return; }
  try {
    const row = await savePageRevision(String(req.params.id), (req as AuthRequest).userId!, revision,
      body, 'metadata');
    if ('title' in body || 'icon' in body) {
      propagateSubPageBlockAttrs(row.id as string, null, null).catch(() => {});
    }
    const userId = (req as AuthRequest).userId!;
    res.json(redactPageForRole(row, await pageRole(String(req.params.id), userId)));
  } catch (error) {
    if (error instanceof PageConflict) res.status(409).json({ error: 'Page revision conflict' });
    else if (error instanceof PageMissing) res.status(404).json({ error: 'Page not found' });
    else res.status(503).json({ error: 'Failed to patch page' });
  }
}

export async function removeCover(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const rows = await query<Page>(
      `UPDATE pages SET cover_url = NULL WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove cover', detail: String(err) });
  }
}

export async function uploadCover(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const cover_url = `/uploads/${file.filename}`;
  try {
    await recordUploadedAsset(file.filename, (req as AuthRequest).userId!);
    const rows = await query<Page>(
      `UPDATE pages SET cover_url = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [cover_url, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    logInfo('page.cover.upload', {
      pageId: id,
      coverUrl: cover_url,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    logError('page.cover.upload.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to upload cover', detail: String(err) });
  }
}

export async function deletePage(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const rows = await query(
      `UPDATE pages SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    logInfo('page.delete.soft', {
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json({ deleted: true });
  } catch (err) {
    logError('page.delete.soft.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to delete page', detail: String(err) });
  }
}

export async function getTrash(req: Request, res: Response): Promise<void> {
  try {
    const rows = await query<Page>(
      `SELECT id, parent_page_id, title, slug, icon, tags, status, due_date, sort_order, updated_at, deleted_at
       FROM pages WHERE owner_user_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [(req as AuthRequest).userId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trash', detail: String(err) });
  }
}

export async function restorePage(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const rows = await query<Page>(
      `UPDATE pages SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found in trash' });
      return;
    }
    logInfo('page.restore', {
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    logError('page.restore.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to restore page', detail: String(err) });
  }
}

export async function permanentDeletePage(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  try {
    const rows = await query(
      `DELETE FROM pages WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found in trash' });
      return;
    }
    logInfo('page.delete.permanent', {
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json({ deleted: true });
  } catch (err) {
    logError('page.delete.permanent.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to permanently delete page', detail: String(err) });
  }
}

export async function emptyTrash(req: Request, res: Response): Promise<void> {
  try {
    await query(`DELETE FROM pages WHERE owner_user_id = $1 AND deleted_at IS NOT NULL`,
      [(req as AuthRequest).userId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to empty trash', detail: String(err) });
  }
}

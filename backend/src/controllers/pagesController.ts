import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { unlink } from 'fs/promises';
import { query } from '../config/database';
import { config } from '../config';
import { InfiniteDoc, Page, PageSummary, PageVersion, TiptapDoc, TiptapNode } from '../types';
import { AuthRequest } from '../middleware/auth';
import { logError, logInfo } from '../utils/logger';

/**
 * Propagates a page's title and/or icon change to all subPageBlock nodes
 * in other pages that reference pageId. Called after title/icon updates.
 */
export async function propagateSubPageBlockAttrs(
  pageId: string,
  title: string | null,
  icon: string | null
): Promise<void> {
  // If icon not provided, fetch it from the page itself so we always sync the latest
  let resolvedIcon = icon;
  let resolvedTitle = title;
  if (resolvedIcon === null || resolvedTitle === null) {
    const pageRows = await query<{ title: string; icon: string | null }>(
      `SELECT title, icon FROM pages WHERE id = $1 AND deleted_at IS NULL`,
      [pageId]
    );
    if (pageRows.length) {
      if (resolvedTitle === null) resolvedTitle = pageRows[0].title;
      if (resolvedIcon === null) resolvedIcon = pageRows[0].icon ?? '';
    }
  }

  // Find all pages whose content contains a subPageBlock referencing pageId
  const rows = await query<{ id: string; content: TiptapDoc }>(
    `SELECT id, content FROM pages
     WHERE deleted_at IS NULL
       AND id != $1
       AND content::text LIKE '%subPageBlock%'
       AND content::text LIKE $2`,
    [pageId, `%${pageId}%`]
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
        `UPDATE pages SET content = $1 WHERE id = $2`,
        [JSON.stringify(updatedContent), row.id]
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
  explicit?: { title: string; content: TiptapDoc | InfiniteDoc },
  opts?: { force?: boolean }
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
  if (!opts?.force && latest[0]?.content_hash === hash) return;

  await query(
    `INSERT INTO page_versions (page_id, title, content, reason, content_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [pageId, title, JSON.stringify(content), reason, hash]
  );

  const keep = Math.max(1, Math.min(1000, config.PAGE_VERSION_RETENTION));
  await query(
    `DELETE FROM page_versions
     WHERE page_id = $1
       AND id IN (
         SELECT id FROM page_versions
         WHERE page_id = $1
         ORDER BY created_at DESC, id DESC
         OFFSET $2
       )`,
    [pageId, keep],
  );
}

export async function getPage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  try {
    const rows = await query<Page>('SELECT * FROM pages WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    const page = rows[0];

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
    logError('page.get.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch page' });
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
    const rows = await query<Page>(
      `INSERT INTO pages (parent_page_id, title, slug, type, content, sort_order, status, due_date, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      ]
    );
    createVersionSnapshot(rows[0].id, 'create', { title: rows[0].title, content: rows[0].content }).catch(() => {});
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
    res.status(500).json({ error: 'Failed to create page' });
  }
}

export async function getSubPages(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
  const tag = typeof req.query.tag === 'string' && req.query.tag.trim() ? req.query.tag.trim() : null;
  const dueFrom = typeof req.query.due_from === 'string' && req.query.due_from.trim() ? req.query.due_from.trim() : null;
  const dueTo = typeof req.query.due_to === 'string' && req.query.due_to.trim() ? req.query.due_to.trim() : null;
  try {
    const rows = await query<Page>(
      `SELECT id, parent_page_id, title, slug, type, icon, tags, status, due_date, working_directory, sort_order, updated_at
       FROM pages
       WHERE parent_page_id = $1
         AND deleted_at IS NULL
         AND ($2::text IS NULL OR status = $2::text)
         AND ($3::text IS NULL OR $3::text = ANY(tags))
         AND ($4::date IS NULL OR due_date >= $4::date)
         AND ($5::date IS NULL OR due_date <= $5::date)
       ORDER BY sort_order, title`,
      [id, status, tag, dueFrom, dueTo]
    );
    res.json(rows);
  } catch (err) {
    logError('page.subpages.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch sub-pages' });
  }
}

export async function getReferences(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  try {
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
         AND id != $1
         AND content::text LIKE $2
       ORDER BY updated_at DESC`,
      [id, `%${id}%`]
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
           AND id = ANY($1::uuid[])
         ORDER BY title`,
        [[...outgoingIds]]
      )
      : [];

    res.json({ incoming, outgoing });
  } catch (err) {
    logError('page.references.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch references' });
  }
}

export async function getPageVersions(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const rawLimit = Number(req.query.limit ?? 30);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 30;
  try {
    const rows = await query<PageVersion>(
      `SELECT id, page_id, title, content, reason, content_hash, created_at
       FROM page_versions
       WHERE page_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [id, limit]
    );
    res.json({ versions: rows });
  } catch (err) {
    logError('page.versions.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
}

export async function restorePageVersion(req: Request, res: Response): Promise<void> {
  const { id, versionId } = req.params as { id: string; versionId: string };
  try {
    const versions = await query<PageVersion>(
      `SELECT id, page_id, title, content, reason, content_hash, created_at
       FROM page_versions
       WHERE id = $1 AND page_id = $2`,
      [versionId, id]
    );
    if (!versions.length) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    const version = versions[0];

    const rows = await query<Page>(
      `UPDATE pages
       SET title = $1,
           content = $2
       WHERE id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [version.title, JSON.stringify(version.content), id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    createVersionSnapshot(id, 'restore', { title: rows[0].title, content: rows[0].content }).catch(() => {});
    logInfo('page.version.restore', {
      pageId: id,
      restoredVersionId: versionId,
      title: rows[0].title,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    logError('page.version.restore.error', {
      detail: String(err),
      pageId: id,
      restoredVersionId: versionId,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to restore version' });
  }
}

const SNAPSHOT_REASONS = ['ia', 'manual'] as const;

export async function snapshotPageVersion(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const reasonRaw = (req.body?.reason ?? 'manual') as string;
  const reason = (SNAPSHOT_REASONS as readonly string[]).includes(reasonRaw) ? reasonRaw : 'manual';
  try {
    const rows = await query<{ id: string; title: string; content: TiptapDoc | InfiniteDoc }>(
      `SELECT id, title, content FROM pages WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    await createVersionSnapshot(
      rows[0].id,
      reason,
      { title: rows[0].title, content: rows[0].content },
      { force: true }
    );
    res.status(204).end();
  } catch (err) {
    logError('page.version.snapshot.error', { detail: String(err), pageId: id });
    res.status(500).json({ error: 'Failed to snapshot version' });
  }
}

export async function savePage(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const { content, title } = req.body as Partial<Page>;
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  try {
    const currentRows = await query<{ id: string; title: string; updated_at: string; content: TiptapDoc | InfiniteDoc }>(
      `SELECT id, title, updated_at, content
       FROM pages
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!currentRows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const current = currentRows[0];
    const nextTitle = title ?? current.title;
    const isUnchanged = current.title === nextTitle
      && JSON.stringify(current.content) === JSON.stringify(content);
    if (isUnchanged) {
      logInfo('page.save.noop', {
        pageId: id,
        hasTitleChange: Boolean(title),
        userId: (req as AuthRequest).userId ?? null,
      });
      res.json(current);
      return;
    }

    const rows = await query<Page>(
      `UPDATE pages
       SET content = $1, title = COALESCE($2, title)
       WHERE id = $3 AND deleted_at IS NULL
       RETURNING id, title, updated_at, content`,
      [JSON.stringify(content), title ?? null, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    createVersionSnapshot(id, title ? 'content+title' : 'content', {
      title: rows[0].title,
      content: rows[0].content,
    }).catch(() => {});
    logInfo('page.save', {
      pageId: id,
      hasTitleChange: Boolean(title),
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    logError('page.save.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to save page' });
  }
}

export async function patchPage(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const {
    title, sort_order, icon, cover_url, cover_position_y, parent_page_id, status, due_date, tags, working_directory, content
  } = req.body as Partial<Page> & { parent_page_id?: string | null };
  // parent_page_id uses a sentinel: undefined = don't touch, null = move to root, string = new parent
  const hasParent = Object.prototype.hasOwnProperty.call(req.body, 'parent_page_id');
  const hasStatus = Object.prototype.hasOwnProperty.call(req.body, 'status');
  const hasDueDate = Object.prototype.hasOwnProperty.call(req.body, 'due_date');
  const hasTags = Object.prototype.hasOwnProperty.call(req.body, 'tags');
  const hasWorkingDirectory = Object.prototype.hasOwnProperty.call(req.body, 'working_directory');
  const hasContent = Object.prototype.hasOwnProperty.call(req.body, 'content');
  const normalizedTags = normalizeTags(tags);

  try {
    // If parent is changing, remove the subPageBlock from the old parent's content
    if (hasParent) {
      const currentRows = await query<{ parent_page_id: string | null }>(
        `SELECT parent_page_id FROM pages WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      const oldParentId = currentRows[0]?.parent_page_id ?? null;
      const newParentId = parent_page_id ?? null;

      if (oldParentId !== newParentId) {
        // Fetch the page being moved (for title/icon)
        const movedRows = await query<{ title: string; icon: string | null }>(
          `SELECT title, icon FROM pages WHERE id = $1 AND deleted_at IS NULL`,
          [id]
        );
        const movedTitle = movedRows[0]?.title ?? '';
        const movedIcon = movedRows[0]?.icon ?? '';

        // Remove subPageBlock from old parent
        if (oldParentId) {
          const oldParentRows = await query<{ id: string; content: TiptapDoc }>(
            `SELECT id, content FROM pages WHERE id = $1 AND deleted_at IS NULL`,
            [oldParentId]
          );
          if (oldParentRows.length) {
            const oldContent = oldParentRows[0].content as TiptapDoc;
            if (oldContent?.content) {
              const filtered = oldContent.content.filter(
                (node: { type: string; attrs?: { pageId?: string } }) =>
                  !(node.type === 'subPageBlock' && node.attrs?.pageId === id)
              );
              if (filtered.length !== oldContent.content.length) {
                await query(
                  `UPDATE pages SET content = $1 WHERE id = $2`,
                  [JSON.stringify({ ...oldContent, content: filtered }), oldParentId]
                );
              }
            }
          }
        }

        // Add subPageBlock to new parent (if there is one)
        if (newParentId) {
          const newParentRows = await query<{ id: string; content: TiptapDoc }>(
            `SELECT id, content FROM pages WHERE id = $1 AND deleted_at IS NULL`,
            [newParentId]
          );
          if (newParentRows.length) {
            const newContent = newParentRows[0].content as TiptapDoc;
            const existingNodes = newContent?.content ?? [];
            // Only add if not already present
            const alreadyThere = existingNodes.some(
              (n: { type: string; attrs?: { pageId?: string } }) =>
                n.type === 'subPageBlock' && n.attrs?.pageId === id
            );
            if (!alreadyThere) {
              const newBlock: TiptapNode = {
                type: 'subPageBlock',
                attrs: { pageId: id, title: movedTitle, icon: movedIcon },
              };
              // Insert before any trailing paragraph, or at end
              const trailingPara = existingNodes.length > 0 &&
                existingNodes[existingNodes.length - 1].type === 'paragraph' &&
                !existingNodes[existingNodes.length - 1].content?.length;
              const updatedNodes = trailingPara
                ? [...existingNodes.slice(0, -1), newBlock, existingNodes[existingNodes.length - 1]]
                : [...existingNodes, newBlock];
              await query(
                `UPDATE pages SET content = $1 WHERE id = $2`,
                [JSON.stringify({ type: 'doc', content: updatedNodes }), newParentId]
              );
            }
          }
        }
      }
    }

    const rows = await query<Page>(
      `UPDATE pages
       SET title = COALESCE($1, title),
           sort_order = COALESCE($2, sort_order),
           icon = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE icon END,
           cover_url = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE cover_url END,
           cover_position_y = COALESCE($6, cover_position_y),
           parent_page_id = CASE WHEN $7 THEN $8::uuid ELSE parent_page_id END,
           status = CASE WHEN $9 THEN $10::text ELSE status END,
           due_date = CASE WHEN $11 THEN $12::date ELSE due_date END,
           tags = CASE WHEN $13 THEN $14::text[] ELSE tags END,
           working_directory = CASE WHEN $15 THEN $16::text ELSE working_directory END,
           content = CASE WHEN $17 THEN $18::jsonb ELSE content END
       WHERE id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [
        title ?? null,
        sort_order ?? null,
        icon ?? null,
        cover_url ?? null,
        id,
        cover_position_y ?? null,
        hasParent,
        parent_page_id ?? null,
        hasStatus,
        status ?? null,
        hasDueDate,
        due_date ?? null,
        hasTags,
        normalizedTags,
        hasWorkingDirectory,
        working_directory ?? null,
        hasContent,
        hasContent ? JSON.stringify(content) : null,
      ]
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    // Propagate title/icon changes to subPageBlocks in other pages
    if (title !== undefined || icon !== undefined) {
      propagateSubPageBlockAttrs(
        id,
        title ?? null,
        icon ?? null
      ).catch(() => {/* silent */});
    }
    if (title !== undefined || hasStatus || hasDueDate || hasTags) {
      createVersionSnapshot(id, 'metadata', { title: rows[0].title, content: rows[0].content }).catch(() => {});
    }

    logInfo('page.patch', {
      pageId: id,
      changedTitle: title !== undefined,
      changedParent: hasParent,
      changedContent: hasContent,
      changedStatus: hasStatus,
      changedDueDate: hasDueDate,
      changedTags: hasTags,
      changedWorkingDirectory: hasWorkingDirectory,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.json(rows[0]);
  } catch (err) {
    logError('page.patch.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to patch page' });
  }
}

export async function removeCover(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
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
    logError('page.cover.remove.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to remove cover' });
  }
}

export async function uploadCover(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const cover_url = `/uploads/${file.filename}`;
  try {
    const rows = await query<Page>(
      `UPDATE pages SET cover_url = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [cover_url, id]
    );
    if (!rows.length) {
      await unlink(file.path).catch(() => {});
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
    await unlink(file.path).catch(() => {});
    logError('page.cover.upload.error', {
      detail: String(err),
      pageId: id,
      userId: (req as AuthRequest).userId ?? null,
    });
    res.status(500).json({ error: 'Failed to upload cover' });
  }
}

export async function deletePage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
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
    res.status(500).json({ error: 'Failed to delete page' });
  }
}

export async function getTrash(req: Request, res: Response): Promise<void> {
  try {
    const rows = await query<Page>(
      `SELECT id, parent_page_id, title, slug, icon, tags, status, due_date, sort_order, updated_at, deleted_at
       FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logError('page.trash.list.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to fetch trash' });
  }
}

export async function restorePage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
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
    res.status(500).json({ error: 'Failed to restore page' });
  }
}

export async function permanentDeletePage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
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
    res.status(500).json({ error: 'Failed to permanently delete page' });
  }
}

export async function emptyTrash(req: Request, res: Response): Promise<void> {
  try {
    await query(`DELETE FROM pages WHERE deleted_at IS NOT NULL`);
    res.json({ deleted: true });
  } catch (err) {
    logError('page.trash.empty.error', { detail: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Failed to empty trash' });
  }
}

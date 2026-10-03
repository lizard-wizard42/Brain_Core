import { PoolClient } from 'pg';
import { pool, query } from '../config/database';
import { createHash } from 'crypto';

export type PageRole = 'owner' | 'editor' | 'viewer';
export const pageAccessSql = `p.owner_user_id = $2 OR EXISTS (
  SELECT 1 FROM page_grants g WHERE g.page_id = p.id AND g.user_id = $2)`;

export async function pageRole(pageId: string, userId: string, client?: PoolClient): Promise<PageRole | null> {
  const sql = `SELECT CASE WHEN p.owner_user_id = $2 THEN 'owner' ELSE g.role END AS role
    FROM pages p LEFT JOIN page_grants g ON g.page_id = p.id AND g.user_id = $2
    WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.owner_user_id = $2 OR g.user_id IS NOT NULL)`;
  const rows = client ? (await client.query<{ role: PageRole }>(sql, [pageId, userId])).rows
    : await query<{ role: PageRole }>(sql, [pageId, userId]);
  return rows[0]?.role ?? null;
}

export function canEdit(role: PageRole | null): boolean { return role === 'owner' || role === 'editor'; }

export class PageConflict extends Error { constructor() { super('Page revision conflict'); } }
export class PageMissing extends Error { constructor() { super('Page not found'); } }

// A moved page must disappear from its former parent's body. Keep explicit @ links.
export function removeMovedChildCard(content: unknown, movedPageId: string): unknown | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as { content?: Array<{ type?: string; attrs?: { pageId?: string; source?: string } }> };
  if (!Array.isArray(doc.content)) return null;
  const index = doc.content.findIndex(node => node.type === 'subPageBlock' &&
    node.attrs?.pageId === movedPageId && node.attrs?.source === 'child');
  const legacyIndex = index < 0 ? doc.content.findIndex(node => node.type === 'subPageBlock' &&
    node.attrs?.pageId === movedPageId && !node.attrs?.source) : -1;
  const removeAt = index >= 0 ? index : legacyIndex;
  if (removeAt < 0) return null;
  return { ...doc, content: doc.content.filter((_, i) => i !== removeAt) };
}

// The row lock serializes saves and revocations. The revision is a monotonic
// counter, independent of timestamp precision and never exposes internal hashes.
export async function savePageRevision(pageId: string, userId: string, revision: number,
  changes: Record<string, unknown>, reason: string, transaction?: PoolClient): Promise<Record<string, unknown>> {
  const client = transaction ?? await pool.connect();
  try {
    if (!transaction) await client.query('BEGIN');
    const current = (await client.query<Record<string, unknown>>(
      'SELECT * FROM pages WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [pageId])).rows[0];
    const role = current ? await pageRole(pageId, userId, client) : null;
    if (!current || !canEdit(role)) throw new PageMissing();
    if (!Number.isSafeInteger(revision) || revision !== Number(current.revision)) throw new PageConflict();
    if (Object.prototype.hasOwnProperty.call(changes, 'parent_page_id')) {
      if (current.owner_user_id !== userId) throw new PageMissing();
      const parent = changes.parent_page_id;
      if (parent !== null) {
        if (typeof parent !== 'string' || parent === pageId) throw new PageMissing();
        const parentRows = (await client.query('SELECT id FROM pages WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL',
          [parent, userId])).rows;
        if (!parentRows.length) throw new PageMissing();
        const cycle = (await client.query(`WITH RECURSIVE ancestors AS (
          SELECT id, parent_page_id FROM pages WHERE id = $1
          UNION
          SELECT p.id, p.parent_page_id FROM pages p JOIN ancestors a ON p.id = a.parent_page_id
        ) SELECT 1 FROM ancestors WHERE id = $2 LIMIT 1`, [parent, pageId])).rows;
        if (cycle.length) throw new PageMissing();
      }
    }
    const allowed = ['title', 'content', 'icon', 'cover_url', 'cover_position_y', 'sort_order',
      'status', 'due_date', 'tags', 'working_directory', 'parent_page_id'];
    if (role !== 'owner' && Object.keys(changes).some(key => !['title', 'content'].includes(key))) {
      throw new PageMissing();
    }
    const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
    if (!entries.length) { if (!transaction) await client.query('COMMIT'); return current; }
    const fields = entries.map(([key], index) => `${key} = $${index + 1}`);
    const values = entries.map(([key, value]) => key === 'content' ? JSON.stringify(value) : value);
    const updated = (await client.query<Record<string, unknown>>(
      `UPDATE pages SET ${fields.join(', ')}, revision = revision + 1, updated_at = NOW()
       WHERE id = $${values.length + 1} RETURNING *`, [...values, pageId])).rows[0];
    await client.query(`INSERT INTO page_versions
      (page_id, title, content, reason, content_hash, author_user_id, page_revision)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [pageId, updated.title,
      JSON.stringify(updated.content), reason,
      createHash('sha256').update(JSON.stringify([updated.title, updated.content])).digest('hex'),
      userId, updated.revision]);
    if (Object.prototype.hasOwnProperty.call(changes, 'parent_page_id') &&
        current.parent_page_id && current.parent_page_id !== changes.parent_page_id) {
      const oldParent = (await client.query<Record<string, unknown>>(
        'SELECT * FROM pages WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [current.parent_page_id, userId])).rows[0];
      const cleaned = oldParent && removeMovedChildCard(oldParent.content, pageId);
      if (cleaned) {
        const parentUpdated = (await client.query<Record<string, unknown>>(
          `UPDATE pages SET content = $1::jsonb, revision = revision + 1, updated_at = NOW()
           WHERE id = $2 RETURNING *`, [JSON.stringify(cleaned), oldParent.id])).rows[0];
        await client.query(`INSERT INTO page_versions
          (page_id, title, content, reason, content_hash, author_user_id, page_revision)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [oldParent.id, parentUpdated.title,
          JSON.stringify(parentUpdated.content), 'child-page-moved',
          createHash('sha256').update(JSON.stringify([parentUpdated.title, parentUpdated.content])).digest('hex'),
          userId, parentUpdated.revision]);
      }
    }
    if (!transaction) await client.query('COMMIT');
    return updated;
  } catch (error) { if (!transaction) await client.query('ROLLBACK'); throw error; }
  finally { if (!transaction) client.release(); }
}

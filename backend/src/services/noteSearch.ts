import { query } from '../config/database';

export async function ownedPagePaths(userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; title: string }[]>();
  const rows = await query<{ origin: string; id: string; title: string; depth: number }>(`
    WITH RECURSIVE ancestors AS (
      SELECT id AS origin, id, title, parent_page_id, 0 AS depth, ARRAY[id] AS visited
      FROM pages WHERE id = ANY($2::uuid[]) AND owner_user_id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT a.origin, p.id, p.title, p.parent_page_id, a.depth + 1, a.visited || p.id
      FROM ancestors a JOIN pages p ON p.id = a.parent_page_id
      WHERE p.owner_user_id = $1 AND p.deleted_at IS NULL AND NOT p.id = ANY(a.visited)
    ) SELECT origin, id, title, depth FROM ancestors ORDER BY origin, depth DESC`, [userId, ids]);
  const paths = new Map<string, { id: string; title: string }[]>();
  for (const row of rows) paths.set(row.origin, [...(paths.get(row.origin) ?? []), { id: row.id, title: row.title }]);
  return paths;
}

const fold = (column: string) => `translate(lower(${column}), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

export async function searchNotes(userId: string, needle: string, kind: string, offset: number, limit = 20) {
  // Traverse only editor content/text: attachment URLs, marks and canvas internals are not searchable text.
  const rows = await query<{ id: string; title: string; kind: 'page' | 'note'; type: 'note' | 'infinite'; icon: string | null;
    updated_at: string; snippet: string; parent_page_id: string | null }>(`
    WITH RECURSIVE nodes AS (
      SELECT id, content AS node, ARRAY[]::bigint[] AS position FROM pages
      WHERE owner_user_id = $1 AND deleted_at IS NULL AND type = 'note' AND $3 != 'notes'
      UNION ALL
      SELECT n.id, child.value, n.position || child.ordinality FROM nodes n
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n.node->'content') = 'array'
        THEN n.node->'content' ELSE '[]'::jsonb END) WITH ORDINALITY child
    ), texts AS (
      SELECT id, string_agg(node->>'text', ' ' ORDER BY position) AS body FROM nodes
      WHERE node->>'type' = 'text' GROUP BY id
    ), documents AS (
      SELECT p.id, p.title, 'page' AS kind, p.type, p.icon, p.updated_at, p.parent_page_id,
        coalesce(t.body, '') AS body FROM pages p LEFT JOIN texts t ON t.id = p.id
      WHERE p.owner_user_id = $1 AND p.deleted_at IS NULL AND $3 != 'notes'
      UNION ALL
      SELECT id, title, 'note', 'note', NULL, updated_at, NULL::uuid,
        concat_ws(' ', body, (SELECT string_agg(item->>'text', ' ') FROM jsonb_array_elements(checklist) item)) FROM remember_notes
      WHERE user_id = $1::text AND $3 != 'pages'
    ), matches AS (
      SELECT *, strpos(${fold('body')}, ${fold('$2')}) AS location,
        strpos(${fold('title')}, ${fold('$2')}) AS title_location FROM documents
    ) SELECT id, title, kind, type, icon, updated_at, parent_page_id,
      CASE WHEN location > 75 THEN '…' ELSE '' END ||
      substring(body FROM greatest(1, location - 74) FOR 180) ||
      CASE WHEN length(body) > greatest(1, location - 74) + 179 THEN '…' ELSE '' END AS snippet
    FROM matches WHERE location > 0 OR title_location > 0
    ORDER BY (title_location > 0) DESC, updated_at DESC, id, kind LIMIT $4 OFFSET $5`, [userId, needle, kind, limit + 1, offset]);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const paths = await ownedPagePaths(userId, items.filter(r => r.kind === 'page').map(r => r.id));
  return { items: items.map(row => ({ ...row, path: paths.get(row.id) ?? [] })), next_offset: hasMore ? offset + limit : null };
}

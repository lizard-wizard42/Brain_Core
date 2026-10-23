import { query } from '../config/database';
import { getEmbedding, cosineSimilarity } from './embeddingService';
import { ownedPagePaths } from './noteSearch';

export interface SemanticSearchResult {
  id: string;
  title: string;
  kind: 'page' | 'note';
  type: 'note' | 'infinite' | 'notebook';
  icon: string | null;
  updated_at: string;
  parent_page_id: string | null;
  snippet: string;
  score: number;
  path?: { id: string; title: string }[];
}

export async function searchSemantic(
  userId: string,
  queryText: string,
  kind = 'all',
  limit = 20
): Promise<{ items: SemanticSearchResult[] }> {
  const queryVector = await getEmbedding(queryText);
  if (!queryVector || queryVector.length === 0) {
    return { items: [] };
  }

  // Fetch candidate embeddings for user
  const candidates = await query<{
    item_id: string;
    item_kind: 'page' | 'note';
    chunk_text: string;
    embedding: number[] | string;
  }>(
    `SELECT item_id, item_kind, chunk_text, embedding
     FROM page_embeddings
     WHERE owner_user_id = $1
       AND ($2 = 'all' OR item_kind = $2)
     ORDER BY updated_at DESC
     LIMIT 500`,
    [userId, kind === 'pages' ? 'page' : kind === 'notes' ? 'note' : 'all']
  );

  if (!candidates.length) {
    return { items: [] };
  }

  // Compute cosine similarity and aggregate top score per item
  const scoredItems = new Map<string, {
    itemId: string;
    kind: 'page' | 'note';
    bestScore: number;
    bestChunk: string;
  }>();

  for (const c of candidates) {
    const vector = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
    const score = cosineSimilarity(queryVector, vector);
    if (score < 0.25) continue; // Noise threshold

    const existing = scoredItems.get(c.item_id);
    if (!existing || score > existing.bestScore) {
      scoredItems.set(c.item_id, {
        itemId: c.item_id,
        kind: c.item_kind,
        bestScore: score,
        bestChunk: c.chunk_text,
      });
    }
  }

  const sortedCandidates = Array.from(scoredItems.values())
    .sort((a, b) => b.bestScore - a.bestScore)
    .slice(0, limit);

  if (!sortedCandidates.length) {
    return { items: [] };
  }

  // Fetch metadata for sorted items
  const pageIds = sortedCandidates.filter(c => c.kind === 'page').map(c => c.itemId);
  const noteIds = sortedCandidates.filter(c => c.kind === 'note').map(c => c.itemId);

  const pageMetaMap = new Map<string, { title: string; type: 'note' | 'infinite' | 'notebook'; icon: string | null; updated_at: string; parent_page_id: string | null }>();
  if (pageIds.length > 0) {
    const pageRows = await query<{
      id: string;
      title: string;
      type: 'note' | 'infinite' | 'notebook';
      icon: string | null;
      updated_at: string;
      parent_page_id: string | null;
    }>(
      `SELECT id, title, type, icon, updated_at, parent_page_id
       FROM pages
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND owner_user_id = $2`,
      [pageIds, userId]
    );
    for (const r of pageRows) pageMetaMap.set(r.id, r);
  }

  const noteMetaMap = new Map<string, { title: string; updated_at: string }>();
  if (noteIds.length > 0) {
    const noteRows = await query<{ id: string; title: string; updated_at: string }>(
      `SELECT id::text, title, updated_at
       FROM remember_notes
       WHERE id::text = ANY($1::text[]) AND deleted_at IS NULL AND user_id = $2`,
      [noteIds, userId]
    );
    for (const r of noteRows) noteMetaMap.set(r.id, r);
  }

  const items: SemanticSearchResult[] = [];
  for (const item of sortedCandidates) {
    if (item.kind === 'page') {
      const meta = pageMetaMap.get(item.itemId);
      if (!meta) continue; // page might be deleted
      items.push({
        id: item.itemId,
        title: meta.title,
        kind: 'page',
        type: meta.type,
        icon: meta.icon,
        updated_at: meta.updated_at,
        parent_page_id: meta.parent_page_id,
        snippet: item.bestChunk.slice(0, 200) + (item.bestChunk.length > 200 ? '…' : ''),
        score: Math.round(item.bestScore * 100) / 100,
      });
    } else {
      const meta = noteMetaMap.get(item.itemId);
      if (!meta) continue;
      items.push({
        id: item.itemId,
        title: meta.title || 'Nota rápida',
        kind: 'note',
        type: 'note',
        icon: '📝',
        updated_at: meta.updated_at,
        parent_page_id: null,
        snippet: item.bestChunk.slice(0, 200) + (item.bestChunk.length > 200 ? '…' : ''),
        score: Math.round(item.bestScore * 100) / 100,
      });
    }
  }

  const paths = await ownedPagePaths(userId, items.filter(r => r.kind === 'page').map(r => r.id));
  return {
    items: items.map(row => ({ ...row, path: paths.get(row.id) ?? [] })),
  };
}

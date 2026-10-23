import { config } from '../config';
import { query } from '../config/database';
import { logError, logInfo } from '../utils/logger';

export interface EmbeddingResult {
  embedding: number[];
}

/**
 * Calls local Ollama service to generate embedding vector for a given text.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const clean = text.trim();
  if (!clean) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${config.OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_EMBED_MODEL,
        prompt: clean.slice(0, 4000), // Protect context limit
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      logError('embedding.ollama.error', { status: res.status, statusText: res.statusText });
      return null;
    }
    const data = (await res.json()) as EmbeddingResult;
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch (err) {
    logError('embedding.fetch.error', { detail: String(err) });
    return null;
  }
}

/**
 * Calculates cosine similarity between two float vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Splits long text into chunks of ~300 words with overlap of 50 words.
 */
export function chunkText(text: string, chunkSize = 300, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= chunkSize) return [words.join(' ')];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Index a page or note's text content into page_embeddings.
 */
export async function indexItemEmbeddings(
  itemId: string,
  itemKind: 'page' | 'note',
  ownerUserId: string,
  title: string,
  fullText: string
): Promise<void> {
  if (!uuidPattern.test(itemId) || !uuidPattern.test(ownerUserId)) {
    return;
  }
  const combined = `${title}\n\n${fullText}`.trim();
  if (!combined) {
    await clearItemEmbeddings(itemId);
    return;
  }

  const chunks = chunkText(combined);
  try {
    // Generate embeddings sequentially to avoid overloading Ollama
    const indexedChunks: { index: number; text: string; vector: number[] }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vector = await getEmbedding(chunks[i]);
      if (vector && vector.length > 0) {
        indexedChunks.push({ index: i, text: chunks[i], vector });
      }
    }

    if (!indexedChunks.length) return;

    // Replace old embeddings for this item
    await query(`DELETE FROM page_embeddings WHERE item_id = $1 AND item_kind = $2`, [itemId, itemKind]);

    for (const chunk of indexedChunks) {
      await query(
        `INSERT INTO page_embeddings (item_id, item_kind, owner_user_id, chunk_index, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (item_id, item_kind, chunk_index)
         DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding, updated_at = NOW()`,
        [itemId, itemKind, ownerUserId, chunk.index, chunk.text, JSON.stringify(chunk.vector)]
      );
    }

    logInfo('embeddings.indexed', {
      itemId,
      itemKind,
      chunks: indexedChunks.length,
    });
  } catch (err) {
    logError('embeddings.index.error', {
      itemId,
      itemKind,
      detail: String(err),
    });
  }
}

/**
 * Removes embeddings when an item is deleted.
 */
export async function clearItemEmbeddings(itemId: string): Promise<void> {
  try {
    await query(`DELETE FROM page_embeddings WHERE item_id = $1`, [itemId]);
  } catch (err) {
    logError('embeddings.clear.error', { itemId, detail: String(err) });
  }
}

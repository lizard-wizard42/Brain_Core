import { query } from '../config/database';

const MAX_PNG_BYTES = 3 * 1024 * 1024;
const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const frameIdPattern = /^shape:[A-Za-z0-9_-]{1,128}$/;

type Preview = { bytes: Buffer; expiresAt: number };
const cache = new Map<string, Preview>();
let totalBytes = 0;

export class DesignPreviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function key(userId: string, pageId: string, revision: number, frameId: string): string {
  return `${userId}:${pageId}:${revision}:${frameId}`;
}
function purge(now = Date.now()): void {
  for (const [id, item] of cache) {
    if (item.expiresAt <= now || totalBytes > MAX_CACHE_BYTES) {
      totalBytes -= item.bytes.length;
      cache.delete(id);
    }
  }
}
function validateId(pageId: string, frameId: string): void {
  if (!uuid.test(pageId) || !frameIdPattern.test(frameId)) throw new DesignPreviewError(400, 'Invalid Design or frame ID');
}
async function ownedDesign(userId: string, pageId: string): Promise<{ revision: number; content: unknown }> {
  const rows = await query<{ revision: number; content: unknown }>(
    "SELECT revision, content FROM pages WHERE id = $1 AND owner_user_id = $2 AND type = 'design' AND deleted_at IS NULL",
    [pageId, userId]);
  if (!rows.length) throw new DesignPreviewError(404, 'Design not found');
  return rows[0];
}
function hasFrame(content: unknown, frameId: string): boolean {
  const doc = content as { data?: { document?: { store?: Record<string, { type?: string; typeName?: string }> } } } | null;
  const shape = doc?.data?.document?.store?.[frameId];
  return shape?.typeName === 'shape' && shape.type === 'frame';
}
function validPng(bytes: unknown): bytes is Buffer {
  return typeof bytes === 'object' && bytes !== null && !Array.isArray(bytes) && Buffer.isBuffer(bytes) && bytes.length >= 24 && bytes.length <= MAX_PNG_BYTES && bytes.subarray(0, 8).equals(pngMagic) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 10000 &&
    bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 10000;
}

export async function storeDesignPreview(userId: string, pageId: string, revision: number, frameId: string, bytes: unknown): Promise<void> {
  validateId(pageId, frameId);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new DesignPreviewError(400, 'Invalid Design revision');
  if (!validPng(bytes)) throw new DesignPreviewError(400, 'Invalid or oversized PNG');
  const page = await ownedDesign(userId, pageId);
  if (page.revision !== revision) throw new DesignPreviewError(409, 'Design revision changed');
  if (!hasFrame(page.content, frameId)) throw new DesignPreviewError(404, 'Frame not found');
  const id = key(userId, pageId, revision, frameId);
  const previous = cache.get(id);
  if (previous) totalBytes -= previous.bytes.length;
  cache.delete(id);
  cache.set(id, { bytes: Buffer.from(bytes), expiresAt: Date.now() + TTL_MS });
  totalBytes += bytes.length;
  purge();
}

export async function getDesignPreview(userId: string, pageId: string, frameId: string): Promise<{ bytes: Buffer; revision: number }> {
  validateId(pageId, frameId);
  const page = await ownedDesign(userId, pageId);
  if (!hasFrame(page.content, frameId)) throw new DesignPreviewError(404, 'Frame not found');
  purge();
  const id = key(userId, pageId, page.revision, frameId);
  const item = cache.get(id);
  if (!item) throw new DesignPreviewError(404, 'Preview not ready. Open this Design page in the browser and wait for the frame to render.');
  cache.delete(id); cache.set(id, item);
  return { bytes: Buffer.from(item.bytes), revision: page.revision };
}

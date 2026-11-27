import { createHash } from 'crypto';
import path from 'path';
import { mkdir, open, unlink } from 'fs/promises';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { hasValidUploadContent, isAllowedImageUpload, reserveUploadCapacity } from '../utils/uploadPolicy';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const mimeExtension: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
};

export class InvalidAgentAsset extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface UploadAgentAssetInput {
  name: string;
  mime_type: string;
  data_base64: string;
}

function decodeImage(input: UploadAgentAssetInput): { bytes: Buffer; ext: string } {
  if (typeof input.name !== 'string' || !input.name || input.name.length > 160 ||
      input.name.includes('/') || input.name.includes('\\') || input.name === '.' || input.name === '..') {
    throw new InvalidAgentAsset(400, 'Invalid image name');
  }
  const ext = mimeExtension[input.mime_type];
  if (!ext || !isAllowedImageUpload(input.name, input.mime_type)) throw new InvalidAgentAsset(400, 'Unsupported image type');
  const encoded = input.data_base64;
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new InvalidAgentAsset(400, 'Invalid base64 image');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
    throw new InvalidAgentAsset(413, 'Image exceeds 10 MiB or has invalid encoding');
  }
  return { bytes, ext };
}

const recentUploads = new Map<string, { count: number; resetAt: number }>();
let lastUploadSweep = 0;
function limitUpload(userId: string): void {
  const now = Date.now();
  if (now - lastUploadSweep >= 60_000) {
    for (const [id, bucket] of recentUploads) if (bucket.resetAt <= now) recentUploads.delete(id);
    lastUploadSweep = now;
  }
  const current = recentUploads.get(userId);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
  if (bucket.count >= 6) throw new InvalidAgentAsset(429, 'Image upload rate limit exceeded');
  bucket.count++;
  recentUploads.set(userId, bucket);
}

export async function uploadAgentAsset(client: PoolClient, userId: string, input: UploadAgentAssetInput) {
  const { bytes, ext } = decodeImage(input);
  limitUpload(userId);
  const digest = createHash('sha256').update(userId).update('\0').update(bytes).digest('hex');
  const relativePath = `design/${digest}${ext}`;
  const directory = path.join(config.UPLOADS_DIR, 'design');
  const absolutePath = path.join(directory, `${digest}${ext}`);
  let release: () => void;
  try { release = await reserveUploadCapacity(bytes.length); }
  catch { throw new InvalidAgentAsset(507, 'Upload storage full'); }
  let created = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const file = await open(absolutePath, 'wx', 0o600);
      created = true;
      try { await file.writeFile(bytes); }
      finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!await hasValidUploadContent(absolutePath, input.name, input.mime_type)) {
      if (created) await unlink(absolutePath).catch(() => {});
      throw new InvalidAgentAsset(400, 'Image contents do not match its type');
    }
    const rows = (await client.query<{ relative_path: string }>(
      `INSERT INTO uploaded_assets (relative_path, owner_user_id) VALUES ($1, $2)
       ON CONFLICT (relative_path) DO UPDATE SET owner_user_id = uploaded_assets.owner_user_id
       WHERE uploaded_assets.owner_user_id = EXCLUDED.owner_user_id RETURNING relative_path`,
      [relativePath, userId],
    )).rows;
    if (!rows.length) throw new InvalidAgentAsset(403, 'Image belongs to another account');
    return { url: `/uploads/${relativePath}`, size_bytes: bytes.length, mime_type: input.mime_type };
  } catch (error) {
    if (created) await unlink(absolutePath).catch(() => {});
    throw error;
  } finally { release(); }
}

export async function listAgentAssets(client: PoolClient, userId: string, limit: number, offset: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new InvalidAgentAsset(400, 'Invalid pagination');
  }
  const rows = (await client.query<{ relative_path: string; created_at: string }>(
    `SELECT relative_path, created_at FROM uploaded_assets
     WHERE owner_user_id = $1 AND relative_path ~* '^([A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\\.(png|jpg|jpeg|webp|gif)$'
     ORDER BY created_at DESC, relative_path DESC LIMIT $2 OFFSET $3`,
    [userId, limit + 1, offset],
  )).rows;
  return { items: rows.slice(0, limit).map(row => ({ url: `/uploads/${row.relative_path}`, created_at: row.created_at })),
    next_offset: rows.length > limit ? offset + limit : null };
}

import path from 'path';
import type { Response } from 'express';

// Raster images only: SVG/HTML can carry script and /uploads shares the app origin.
const SAFE_IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

const INLINE_TYPES: Record<string, string> = {
  ...SAFE_IMAGE_TYPES,
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export function isSafeImageUpload(file: { mimetype?: string; originalname?: string }): boolean {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const expected = SAFE_IMAGE_TYPES[ext];
  return !!expected && String(file.mimetype || '').toLowerCase() === expected;
}

export function coverImageFilter(
  _req: unknown,
  file: { mimetype?: string; originalname?: string },
  cb: (err: Error | null, accept?: boolean) => void,
): void {
  cb(null, isSafeImageUpload(file));
}

// Applied to every /uploads response, including legacy files already on disk.
export function setUploadHeaders(res: Response, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  const inlineType = INLINE_TYPES[ext];
  if (inlineType) {
    res.setHeader('Content-Type', inlineType);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
  }
}

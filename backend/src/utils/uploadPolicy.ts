import path from 'path';
import { open, readdir, stat, unlink } from 'fs/promises';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

const IMAGE_TYPES = new Map<string, ReadonlySet<string>>([
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.gif', new Set(['image/gif'])],
  ['.webp', new Set(['image/webp'])],
  ['.avif', new Set(['image/avif'])],
]);

const ATTACHMENT_TYPES = new Map<string, ReadonlySet<string>>([
  ['.pdf', new Set(['application/pdf', 'application/octet-stream'])],
  ['.doc', new Set(['application/msword', 'application/octet-stream'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'])],
  ['.xls', new Set(['application/vnd.ms-excel', 'application/octet-stream'])],
  ['.xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])],
  ['.csv', new Set(['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'])],
  ['.ppt', new Set(['application/vnd.ms-powerpoint', 'application/octet-stream'])],
  ['.pptx', new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream'])],
  ['.txt', new Set(['text/plain', 'application/octet-stream'])],
  ['.rtf', new Set(['application/rtf', 'text/rtf', 'application/octet-stream'])],
  ['.odt', new Set(['application/vnd.oasis.opendocument.text', 'application/octet-stream'])],
  ['.ods', new Set(['application/vnd.oasis.opendocument.spreadsheet', 'application/octet-stream'])],
]);

function matchesAllowedType(
  allowedTypes: ReadonlyMap<string, ReadonlySet<string>>,
  originalName: string,
  mimeType: string,
): boolean {
  const ext = path.extname(originalName || '').toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase().split(';', 1)[0].trim();
  return allowedTypes.get(ext)?.has(normalizedMime) === true;
}

export function isAllowedImageUpload(originalName: string, mimeType: string): boolean {
  return matchesAllowedType(IMAGE_TYPES, originalName, mimeType);
}

export function isAllowedPngUpload(originalName: string, mimeType: string): boolean {
  return path.extname(originalName || '').toLowerCase() === '.png'
    && String(mimeType || '').toLowerCase().split(';', 1)[0].trim() === 'image/png';
}

export function isAllowedAttachmentUpload(originalName: string, mimeType: string): boolean {
  return isAllowedImageUpload(originalName, mimeType)
    || matchesAllowedType(ATTACHMENT_TYPES, originalName, mimeType);
}

export function safeUploadExtension(originalName: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  return IMAGE_TYPES.has(ext) || ATTACHMENT_TYPES.has(ext) ? ext : '';
}

export function isAllowedStoredUploadPath(filePath: string): boolean {
  const ext = path.extname(filePath || '').toLowerCase();
  // Arquivos antigos sem extensão são entregues como octet-stream + nosniff.
  return ext === '' || IMAGE_TYPES.has(ext) || ATTACHMENT_TYPES.has(ext);
}

function startsWithBytes(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((value, index) => buffer[index] === value);
}

function looksLikeSafeText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const sample = buffer.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return !/^<(?:!doctype\s+html|html|script|svg|iframe|object|embed)(?:\s|>)/.test(sample);
}

export async function hasValidUploadContent(filePath: string, originalName: string): Promise<boolean> {
  const ext = path.extname(originalName || '').toLowerCase();
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);

    if (ext === '.png') return startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (ext === '.jpg' || ext === '.jpeg') return startsWithBytes(head, [0xff, 0xd8, 0xff]);
    if (ext === '.gif') return head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a';
    if (ext === '.webp') return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
    if (ext === '.avif') return head.subarray(4, 8).toString('ascii') === 'ftyp'
      && ['avif', 'avis'].includes(head.subarray(8, 12).toString('ascii'));
    if (ext === '.pdf') return head.subarray(0, 1024).includes(Buffer.from('%PDF-'));
    if (['.doc', '.xls', '.ppt'].includes(ext)) return startsWithBytes(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (['.docx', '.xlsx', '.pptx', '.odt', '.ods'].includes(ext)) {
      return startsWithBytes(head, [0x50, 0x4b, 0x03, 0x04]);
    }
    if (ext === '.rtf') return head.toString('ascii', 0, 5) === '{\\rtf';
    if (ext === '.txt' || ext === '.csv') return looksLikeSafeText(head);
    return false;
  } finally {
    await handle.close();
  }
}

export async function discardInvalidUpload(file: Express.Multer.File | undefined): Promise<boolean> {
  if (!file) return false;
  const valid = await hasValidUploadContent(file.path, file.originalname).catch(() => false);
  if (!valid) await unlink(file.path).catch(() => {});
  return !valid;
}

export async function validateUploadedFileContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.file) {
    next();
    return;
  }
  if (await discardInvalidUpload(req.file)) {
    res.status(400).json({ error: 'Conteúdo do arquivo não corresponde ao formato informado' });
    return;
  }
  next();
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

let reservedUploadBytes = 0;
let capacityLock: Promise<void> = Promise.resolve();

async function withCapacityLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = capacityLock;
  let release: () => void = () => {};
  capacityLock = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Rejects a multipart request before Multer writes it when the local upload
 * store would exceed its configured capacity. This is intentionally a global
 * cap: the first public edition is a single-owner installation, not a
 * multi-tenant service.
 */
export async function ensureUploadStorageCapacity(req: Request, res: Response, next: NextFunction): Promise<void> {
  const limit = Math.max(0, config.UPLOADS_MAX_BYTES);
  const header = req.headers['content-length'];
  const declaredLength = typeof header === 'string' ? Number(header) : Number.NaN;
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > limit) {
    res.status(413).json({ error: 'Upload maior que a capacidade permitida' });
    return;
  }

  try {
    const accepted = await withCapacityLock(async () => {
      const used = await directorySize(config.UPLOADS_DIR);
      if (used + reservedUploadBytes + declaredLength > limit) return false;
      reservedUploadBytes += declaredLength;
      return true;
    });
    if (!accepted) {
      res.status(507).json({ error: 'Armazenamento local de uploads cheio' });
      return;
    }
    let released = false;
    const releaseReservation = () => {
      if (!released) {
        reservedUploadBytes = Math.max(0, reservedUploadBytes - declaredLength);
        released = true;
      }
    };
    res.once('finish', releaseReservation);
    res.once('close', releaseReservation);
    next();
  } catch {
    res.status(503).json({ error: 'Não foi possível verificar o armazenamento de uploads' });
  }
}

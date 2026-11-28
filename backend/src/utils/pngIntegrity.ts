import { PNG } from 'pngjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DIMENSION = 10_000;
const MAX_PIXELS = 32_000_000;

/** Decode before accepting a PNG so a valid header cannot hide broken IDAT pixels. */
export function hasValidPngPixels(bytes: Buffer): boolean {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || !bytes.subarray(0, 8).equals(SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) return false;
  try {
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    return decoded.width === width && decoded.height === height && decoded.data.length === width * height * 4;
  } catch {
    return false;
  }
}

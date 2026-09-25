import crypto from 'crypto';
import { config } from '../config';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let aggregate = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    aggregate = (aggregate << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((aggregate >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  );

  return String(binaryCode % 1_000_000).padStart(6, '0');
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function normalizeTotpCode(code: string): string {
  return code.replace(/\s+/g, '').replace(/-/g, '').trim();
}

export function verifyTotp(secret: string, code: string, timestamp = Date.now()): boolean {
  const normalizedCode = normalizeTotpCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  const currentCounter = Math.floor(timestamp / 1000 / 30);

  for (let delta = -1; delta <= 1; delta += 1) {
    if (hotp(secret, currentCounter + delta) === normalizedCode) {
      return true;
    }
  }

  return false;
}

export function buildOtpAuthUri(email: string, secret: string): string {
  const label = `${config.TOTP_ISSUER}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer: config.TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

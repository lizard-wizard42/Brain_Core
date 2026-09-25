import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../config/database';

export interface AuthRequest extends Request {
  userId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  sv: number;
  type?: string;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
}

function parseCookies(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader) return {};
  return rawCookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const index = part.indexOf('=');
    if (index <= 0) return acc;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

export function extractAccessToken(headers: Request['headers']): string {
  const cookies = parseCookies(typeof headers.cookie === 'string' ? headers.cookie : undefined);
  const cookieToken = cookies[config.AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const header = headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  return '';
}

export async function authenticateAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const payload = verifyAccessToken(token);
    if (!payload?.sub || payload.type !== 'access' || !Number.isInteger(payload.sv)) {
      return null;
    }
    const rows = await query<{ session_version: number }>(
      'SELECT session_version FROM users WHERE id = $1',
      [payload.sub]
    );
    if (!rows.length || rows[0].session_version !== payload.sv) {
      return null;
    }
  } catch {
    return null;
  }

  return verifyAccessToken(token);
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractAccessToken(req.headers);
  if (!token) {
    res.status(401).json({ error: 'Sessão ausente' });
    return;
  }

  const payload = await authenticateAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }

  req.userId = payload.sub;
  next();
}

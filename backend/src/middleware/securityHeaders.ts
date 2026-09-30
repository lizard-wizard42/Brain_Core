import type { Request, Response, NextFunction } from 'express';

/**
 * Defensive headers for JSON API responses. Uploads and the static frontend set
 * their own headers (PDF preview needs framing), so this is mounted on /api only.
 */
export function apiSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

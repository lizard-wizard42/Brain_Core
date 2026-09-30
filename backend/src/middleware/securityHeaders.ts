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

/**
 * HSTS only on requests that really arrived over HTTPS (Express `trust proxy` reads
 * X-Forwarded-Proto from Tailscale Serve). Sending it on plain-HTTP LAN access would be
 * ignored by browsers anyway, and never add `preload`/`includeSubDomains` here.
 */
export function hstsWhenSecure(req: Request, res: Response, next: NextFunction): void {
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

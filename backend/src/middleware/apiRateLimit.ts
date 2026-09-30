import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getClientIp } from './clientIp';

interface Options {
  windowMs: number;
  max: number;
  now?: () => number;
}

interface Bucket { count: number; resetAt: number }

/**
 * Fixed-window, in-memory limiter keyed by client IP. It is a backstop against
 * runaway clients and scraping, not a replacement for login throttling; state is
 * per process, which matches the single-backend deployment.
 */
export function createApiRateLimit({ windowMs, max, now = Date.now }: Options): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const t = now();
    if (t - lastSweep > windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(key);
      lastSweep = t;
    }

    const key = getClientIp(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Muitas requisições. Tente novamente em instantes.', retryAfterSeconds: retryAfter });
      return;
    }
    next();
  };
}

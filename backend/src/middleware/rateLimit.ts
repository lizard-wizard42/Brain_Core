import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-user token bucket. Starts full at `burst`; refills `ratePerMin` tokens per
 * minute. Keyed by the authenticated `userId` (falls back to IP). In-memory and
 * single-process — this caps the blast radius of a leaked session/token, it is
 * not a distributed rate limiter. Put it AFTER `authMiddleware`.
 */
export function perUserRateLimit(opts: { burst: number; ratePerMin: number }) {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = opts.ratePerMin / 60_000;
  let lastSweep = Date.now();

  function sweep(now: number): void {
    if (now - lastSweep < 300_000) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > 600_000) buckets.delete(key);
    }
  }

  return function rateLimit(req: AuthRequest, res: Response, next: NextFunction): void {
    const now = Date.now();
    sweep(now);

    const key = req.userId || req.ip || 'anon';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: opts.burst, updatedAt: now };
      buckets.set(key, bucket);
    } else {
      bucket.tokens = Math.min(opts.burst, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
      bucket.updatedAt = now;
    }

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: 'Muitas requisições. Aguarde um momento.', retryAfterSeconds });
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { getClientIp } from '../middleware/clientIp';

interface AttemptBucket {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const ipAttempts = new Map<string, AttemptBucket>();
const MAX_IP_BUCKETS = 10_000;
let lastSweepAt = 0;

function now(): number {
  return Date.now();
}

function sweepExpiredBuckets(timestamp: number): void {
  if (timestamp - lastSweepAt < 300_000 && ipAttempts.size < MAX_IP_BUCKETS) return;
  lastSweepAt = timestamp;
  const retentionMs = Math.max(config.LOGIN_IP_WINDOW_MS, config.LOGIN_LOCK_MS) * 2;
  for (const [ip, bucket] of ipAttempts) {
    if (timestamp - bucket.windowStartedAt > retentionMs && bucket.blockedUntil <= timestamp) {
      ipAttempts.delete(ip);
    }
  }
}

function getOrCreateBucket(ip: string, timestamp: number): AttemptBucket {
  sweepExpiredBuckets(timestamp);
  const existing = ipAttempts.get(ip);
  if (!existing) {
    if (ipAttempts.size >= MAX_IP_BUCKETS) {
      let oldestUnblocked: { ip: string; updatedAt: number } | null = null;
      for (const [candidateIp, candidate] of ipAttempts) {
        if (candidate.blockedUntil > timestamp) continue;
        if (!oldestUnblocked || candidate.windowStartedAt < oldestUnblocked.updatedAt) {
          oldestUnblocked = { ip: candidateIp, updatedAt: candidate.windowStartedAt };
        }
      }
      if (!oldestUnblocked) {
        return { count: config.LOGIN_IP_MAX_ATTEMPTS, windowStartedAt: timestamp, blockedUntil: timestamp + config.LOGIN_LOCK_MS };
      }
      ipAttempts.delete(oldestUnblocked.ip);
    }
    const fresh = { count: 0, windowStartedAt: timestamp, blockedUntil: 0 };
    ipAttempts.set(ip, fresh);
    return fresh;
  }
  if (timestamp - existing.windowStartedAt > config.LOGIN_IP_WINDOW_MS) {
    existing.count = 0;
    existing.windowStartedAt = timestamp;
  }
  if (existing.blockedUntil && timestamp >= existing.blockedUntil) {
    existing.blockedUntil = 0;
    existing.count = 0;
    existing.windowStartedAt = timestamp;
  }
  return existing;
}

export function loginIpRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const timestamp = now();
  const ip = getClientIp(req);
  const bucket = getOrCreateBucket(ip, timestamp);

  if (bucket.blockedUntil > timestamp) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntil - timestamp) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Muitas tentativas de login. Aguarde antes de tentar novamente.',
      retryAfterSeconds,
    });
    return;
  }

  next();
}

export function registerFailedIpLoginAttempt(req: Request): void {
  const timestamp = now();
  const ip = getClientIp(req);
  const bucket = getOrCreateBucket(ip, timestamp);
  bucket.count += 1;

  if (bucket.count >= config.LOGIN_IP_MAX_ATTEMPTS) {
    bucket.blockedUntil = timestamp + config.LOGIN_LOCK_MS;
  }
}

export function clearFailedIpLoginAttempts(req: Request): void {
  ipAttempts.delete(getClientIp(req));
}

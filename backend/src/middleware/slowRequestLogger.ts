import type { Request, Response, NextFunction } from 'express';
import { logWarn } from '../utils/logger';

/** Emits one structured warning for each request slower than the threshold (tail latency, not averages). */
export function slowRequestLogger(thresholdMs: number, now: () => number = Date.now) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = now();
    res.on('finish', () => {
      const durationMs = now() - startedAt;
      if (durationMs >= thresholdMs) {
        logWarn('http.slow_request', {
          method: req.method,
          path: req.baseUrl + req.path,
          status: res.statusCode,
          durationMs,
        });
      }
    });
    next();
  };
}

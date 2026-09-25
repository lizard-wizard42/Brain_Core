import type { Request } from 'express';

export function getClientIp(req: Pick<Request, 'ip' | 'socket'>): string {
  const resolved = String(req.ip || req.socket.remoteAddress || 'unknown').trim();
  return (resolved || 'unknown').slice(0, 120);
}

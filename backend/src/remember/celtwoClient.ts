import { config } from '../config/index';

export class CeltwoUnavailableError extends Error {
  constructor(message = 'Celtwo offline', public readonly statusCode?: number) {
    super(message);
    this.name = 'CeltwoUnavailableError';
  }
}

function buildUrl(path: string): string {
  return `${config.CELTWO_MEMORY_URL.replace(/\/$/, '')}${path}`;
}

export async function celtwoRequest<T>(path: string, init?: RequestInit, timeoutMs = config.CELTWO_MEMORY_TIMEOUT_MS): Promise<T> {
  if (!config.CELTWO_MEMORY_URL) throw new CeltwoUnavailableError('Celtwo não configurado');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(config.CELTWO_MEMORY_TOKEN ? { Authorization: `Bearer ${config.CELTWO_MEMORY_TOKEN}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw new CeltwoUnavailableError(`Celtwo respondeu HTTP ${response.status}`, response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) throw error;
    throw new CeltwoUnavailableError(error instanceof Error ? error.message : 'Falha ao comunicar com Celtwo');
  } finally {
    clearTimeout(timeout);
  }
}

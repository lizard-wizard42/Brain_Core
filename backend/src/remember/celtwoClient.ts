import { config } from '../config/index';

export class CeltwoUnavailableError extends Error {
  constructor(message = 'Serviço de gravação offline', public readonly statusCode?: number) {
    super(message);
    this.name = 'CeltwoUnavailableError';
  }
}

function buildUrl(path: string): string {
  return `${config.CELTWO_MEMORY_URL.replace(/\/$/, '')}${path}`;
}

export async function celtwoRequest<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  if (!config.CELTWO_MEMORY_URL) throw new CeltwoUnavailableError('Serviço de gravação não configurado');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? config.CELTWO_MEMORY_TIMEOUT_MS);
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
    if (!response.ok) throw new CeltwoUnavailableError(`Serviço de gravação respondeu HTTP ${response.status}`, response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) throw error;
    throw new CeltwoUnavailableError(error instanceof Error ? error.message : 'Falha ao comunicar com o serviço de gravação');
  } finally {
    clearTimeout(timeout);
  }
}

/** Igual ao celtwoRequest, mas devolve o Response cru (sem .json()) — para
 *  repassar bytes (ex.: áudio de segmento). Mesmo timeout, auth e mapeamento
 *  de erro. */
export async function celtwoRequestRaw(path: string, init?: RequestInit): Promise<Response> {
  if (!config.CELTWO_MEMORY_URL) throw new CeltwoUnavailableError('Serviço de gravação não configurado');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.CELTWO_MEMORY_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(config.CELTWO_MEMORY_TOKEN ? { Authorization: `Bearer ${config.CELTWO_MEMORY_TOKEN}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) throw new CeltwoUnavailableError(`Serviço de gravação respondeu HTTP ${response.status}`, response.status);
    return response;
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) throw error;
    throw new CeltwoUnavailableError(error instanceof Error ? error.message : 'Falha ao comunicar com o serviço de gravação');
  } finally {
    clearTimeout(timeout);
  }
}

import { config } from '../config/index';
import { celtwoRequest, CeltwoUnavailableError } from './celtwoClient';
import type { RememberDay, RememberSearchResponse, RememberSession, RememberStatus, RememberTranscript, RememberVoiceprint } from './schemas';

const mockStartedAt = new Map<string, string>();
let cachedStatus: RememberStatus | null = null;
let cachedStatusAt = 0;
const STATUS_CACHE_MS = 3000;

interface CeltwoPhaseOneStatus {
  version?: string;
  uptime_seconds?: number;
  recording: boolean;
  last_sync: string | null;
}

function normalizePhaseOneStatus(status: CeltwoPhaseOneStatus): RememberStatus {
  return {
    state: status.recording ? 'recording' : 'stopped',
    started_at: null,
    last_communication_at: new Date().toISOString(),
    device_id: null,
    message: status.version ? `Celtwo ${status.version}` : 'Celtwo online',
  };
}

function mockStatus(userId: string): RememberStatus {
  const startedAt = mockStartedAt.get(userId) ?? null;
  return {
    state: startedAt ? 'recording' : 'stopped',
    started_at: startedAt,
    last_communication_at: new Date().toISOString(),
    device_id: 'celtwo-mock',
    message: 'Modo de desenvolvimento',
  };
}

function offlineStatus(message = 'Celtwo offline'): RememberStatus {
  return { state: 'offline', started_at: null, last_communication_at: cachedStatus?.last_communication_at ?? null, device_id: cachedStatus?.device_id ?? null, message };
}

export async function getRememberStatus(userId: string): Promise<RememberStatus> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return mockStatus(userId);
  if (config.CELTWO_MEMORY_MODE === 'offline') return offlineStatus('Celtwo não configurado');
  if (cachedStatus && Date.now() - cachedStatusAt < STATUS_CACHE_MS) return cachedStatus;
  try {
    try {
      cachedStatus = await celtwoRequest<RememberStatus>('/status');
    } catch {
      const phaseOneStatus = await celtwoRequest<CeltwoPhaseOneStatus>('/api/v1/status');
      cachedStatus = normalizePhaseOneStatus(phaseOneStatus);
    }
    cachedStatusAt = Date.now();
    return cachedStatus;
  } catch (error) {
    if (error instanceof CeltwoUnavailableError) return offlineStatus(error.message);
    throw error;
  }
}

export async function setRememberRecording(userId: string, recording: boolean): Promise<RememberStatus> {
  if (config.CELTWO_MEMORY_MODE === 'mock') {
    if (recording) mockStartedAt.set(userId, new Date().toISOString());
    else mockStartedAt.delete(userId);
    return mockStatus(userId);
  }
  if (config.CELTWO_MEMORY_MODE === 'offline') throw new CeltwoUnavailableError('Celtwo offline');
  cachedStatus = await celtwoRequest<RememberStatus>(recording ? '/start' : '/stop', { method: 'POST' });
  cachedStatusAt = Date.now();
  return cachedStatus;
}

export async function getRememberYears(userId: string): Promise<number[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return [new Date().getFullYear()];
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];
  try { return await celtwoRequest<number[]>(`/years?owner_user_id=${encodeURIComponent(userId)}`); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberMonths(year: number, userId: string): Promise<number[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return year === new Date().getFullYear() ? [new Date().getMonth() + 1] : [];
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];
  try { return await celtwoRequest<number[]>(`/years/${year}/months?owner_user_id=${encodeURIComponent(userId)}`); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberDays(year: number, month: number, userId: string): Promise<string[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') {
    const now = new Date();
    return year === now.getFullYear() && month === now.getMonth() + 1 ? [now.toISOString().slice(0, 10)] : [];
  }
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];
  try { return await celtwoRequest<string[]>(`/years/${year}/months/${month}/days?owner_user_id=${encodeURIComponent(userId)}`); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberDay(date: string, userId: string): Promise<RememberDay> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return { date, total_seconds: 0, session_count: 0, sessions: [] };
  if (config.CELTWO_MEMORY_MODE === 'offline') return { date, total_seconds: 0, session_count: 0, sessions: [] };
  try { return await celtwoRequest<RememberDay>(`/days/${encodeURIComponent(date)}?owner_user_id=${encodeURIComponent(userId)}`); }
  catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) {
      return {
        date,
        total_seconds: 0,
        session_count: 0,
        sessions: [],
        history_available: false,
        message: 'O Celtwo está online, mas o histórico temporal ainda não está disponível nesta versão.',
      };
    }
    throw error;
  }
}

export async function getRememberSessions(userId: string, date?: string): Promise<RememberSession[]> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return [];
  const query = `?owner_user_id=${encodeURIComponent(userId)}${date ? `&date=${encodeURIComponent(date)}` : ''}`;
  try { return await celtwoRequest<RememberSession[]>(`/sessions${query}`); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberTranscript(sessionId: string, userId: string): Promise<RememberTranscript> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { session_id: sessionId, status: 'ready', text: null };
  return celtwoRequest<RememberTranscript>(`/sessions/${encodeURIComponent(sessionId)}/transcript?owner_user_id=${encodeURIComponent(userId)}`);
}

export async function getRememberSearch(userId: string, q: string, limit?: number, speaker?: string): Promise<RememberSearchResponse> {
  const query = q.trim();
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { query, results: [] };
  const params = new URLSearchParams({ q: query, owner_user_id: userId });
  if (limit) params.set('limit', String(limit));
  if (speaker) params.set('speaker', speaker);
  try {
    return await celtwoRequest<RememberSearchResponse>(`/search?${params.toString()}`);
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return { query, results: [] };
    throw error;
  }
}

const EMPTY_VOICEPRINT: RememberVoiceprint = { enrolled: false, updated_at: null, sample_seconds: null, model: null };

export async function getRememberVoiceprint(userId: string): Promise<RememberVoiceprint> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return EMPTY_VOICEPRINT;
  try {
    return await celtwoRequest<RememberVoiceprint>(`/voiceprint?owner_user_id=${encodeURIComponent(userId)}`);
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return EMPTY_VOICEPRINT;
    throw error;
  }
}

interface EnrollResult { enrolled: boolean; sample_seconds: number | null; model: string | null }

export async function enrollRememberVoiceprint(userId: string, body: Buffer, contentType: string): Promise<EnrollResult> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Celtwo offline');
  return celtwoRequest<EnrollResult>(`/voiceprint?owner_user_id=${encodeURIComponent(userId)}`, { method: 'POST', body, headers: { 'Content-Type': contentType } }, config.CELTWO_MEMORY_UPLOAD_TIMEOUT_MS);
}

export async function deleteRememberVoiceprint(userId: string): Promise<{ enrolled: boolean }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { enrolled: false };
  return celtwoRequest<{ enrolled: boolean }>(`/voiceprint?owner_user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function enrollRememberVoiceprintFromSession(userId: string, sessionId: string): Promise<EnrollResult> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Celtwo offline');
  return celtwoRequest<EnrollResult>(`/voiceprint/from-session/${encodeURIComponent(sessionId)}?owner_user_id=${encodeURIComponent(userId)}`, { method: 'POST' }, config.CELTWO_MEMORY_UPLOAD_TIMEOUT_MS);
}

export interface ParticipantIdentity { id: string; display_name: string }
export interface ParticipantDecision { identity_id: string | null; display_name?: string | null; action: 'confirm' | 'correct' | 'ignore' | 'undo'; created_at: string }
export interface ParticipantSuggestion { identity_id: string; display_name: string; similarity: number; model: string; template_id: string }

function participantPath(userId: string, suffix: string): string {
  return `/participants/${suffix}?owner_user_id=${encodeURIComponent(userId)}`;
}
function segmentPath(userId: string, sessionId: string, segmentId: number, suffix: string): string {
  return `${participantPath(userId, `segments/${segmentId}/${suffix}`)}&session_id=${encodeURIComponent(sessionId)}`;
}

function participantRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Celtwo offline');
  return celtwoRequest<T>(path, init);
}

export const participants = {
  list: (userId: string) => participantRequest<ParticipantIdentity[]>(participantPath(userId, 'identities')),
  create: (userId: string, displayName: string) => participantRequest<ParticipantIdentity>(participantPath(userId, 'identities'), { method: 'POST', body: JSON.stringify({ display_name: displayName }) }),
  decision: (userId: string, sessionId: string, segmentId: number) => participantRequest<ParticipantDecision | null>(segmentPath(userId, sessionId, segmentId, 'decision')),
  suggestions: (userId: string, sessionId: string, segmentId: number) => participantRequest<ParticipantSuggestion[]>(segmentPath(userId, sessionId, segmentId, 'suggestions')),
  decide: (userId: string, sessionId: string, segmentId: number, action: ParticipantDecision['action'], identityId: string | null) => participantRequest<ParticipantDecision>(segmentPath(userId, sessionId, segmentId, 'decision'), { method: 'POST', body: JSON.stringify({ action, identity_id: identityId }) }),
  createTemplate: (userId: string, sessionId: string, segmentId: number) => participantRequest<unknown>(segmentPath(userId, sessionId, segmentId, 'template'), { method: 'POST' }),
};

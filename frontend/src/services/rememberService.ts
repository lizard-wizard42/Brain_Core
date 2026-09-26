import { apiRequest } from '../api/client';
import type { RememberDay, RememberSearchResponse, RememberSession, RememberSpeaker, RememberStatus, RememberTranscript, RememberVoiceprint } from '../types';

const ROOT = '/api/remember/memory';
export interface ParticipantIdentity { id: string; display_name: string }
export interface ParticipantDecision { identity_id: string | null; display_name?: string | null; action: 'confirm' | 'correct' | 'ignore' | 'undo'; created_at: string }
export interface ParticipantSuggestion { identity_id: string; display_name: string; similarity: number }
export interface SegmentParticipants { decision: ParticipantDecision | null; suggestions: ParticipantSuggestion[] }
const participantRoot = (sessionId: string) => `${ROOT}/sessions/${encodeURIComponent(sessionId)}/participants`;

export const rememberService = {
  getStatus: async () => apiRequest<RememberStatus>(`${ROOT}/status`),
  start: async () => apiRequest<RememberStatus>(`${ROOT}/start`, { method: 'POST' }),
  stop: async () => apiRequest<RememberStatus>(`${ROOT}/stop`, { method: 'POST' }),
  getYears: async () => (await apiRequest<{ years: number[] }>(`${ROOT}/years`)).years,
  getMonths: async (year: number) => (await apiRequest<{ months: number[] }>(`${ROOT}/years/${year}/months`)).months,
  getDays: async (year: number, month: number) => (await apiRequest<{ days: string[] }>(`${ROOT}/years/${year}/months/${month}/days`)).days,
  getDay: async (date: string) => apiRequest<RememberDay>(`${ROOT}/days/${encodeURIComponent(date)}`),
  getSessions: async (date?: string) => (await apiRequest<{ sessions: RememberSession[] }>(`${ROOT}/sessions${date ? `?date=${encodeURIComponent(date)}` : ''}`)).sessions,
  getTranscript: async (sessionId: string) => apiRequest<RememberTranscript>(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/transcript`),
  getParticipantIdentities: async (sessionId: string) => apiRequest<ParticipantIdentity[]>(`${participantRoot(sessionId)}/identities`),
  createParticipantIdentity: async (sessionId: string, displayName: string) => apiRequest<ParticipantIdentity>(`${participantRoot(sessionId)}/identities`, { method: 'POST', body: JSON.stringify({ display_name: displayName }) }),
  getSegmentParticipants: async (sessionId: string, segmentId: number) => apiRequest<SegmentParticipants>(`${participantRoot(sessionId)}/segments/${segmentId}`),
  decideSegment: async (sessionId: string, segmentId: number, action: ParticipantDecision['action'], identityId: string | null = null) => apiRequest<ParticipantDecision>(`${participantRoot(sessionId)}/segments/${segmentId}/decision`, { method: 'POST', body: JSON.stringify({ action, identity_id: identityId }) }),
  createParticipantTemplate: async (sessionId: string, segmentId: number) => apiRequest<unknown>(`${participantRoot(sessionId)}/segments/${segmentId}/template`, { method: 'POST' }),
  search: async (q: string, limit?: number, speaker?: RememberSpeaker) => {
    const query = `q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}${speaker ? `&speaker=${speaker}` : ''}`;
    return apiRequest<RememberSearchResponse>(`${ROOT}/search?${query}`);
  },
  getVoiceprint: async () => apiRequest<RememberVoiceprint>(`${ROOT}/voiceprint`),
  enrollVoiceprint: async (audio: Blob) =>
    apiRequest<{ enrolled: boolean; sample_seconds: number | null; model: string | null }>(`${ROOT}/voiceprint`, {
      method: 'POST',
      body: audio,
      headers: { 'Content-Type': audio.type || 'audio/webm' },
    }),
  deleteVoiceprint: async () => apiRequest<{ enrolled: boolean }>(`${ROOT}/voiceprint`, { method: 'DELETE' }),
  enrollVoiceprintFromSession: async (sessionId: string) =>
    apiRequest<{ enrolled: boolean; sample_seconds: number | null; model: string | null }>(
      `${ROOT}/voiceprint/from-session/${encodeURIComponent(sessionId)}`,
      { method: 'POST' },
    ),
};

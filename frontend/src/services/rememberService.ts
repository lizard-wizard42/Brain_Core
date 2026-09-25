import { apiRequest, apiUrl } from '../api/client';
import type { RememberDay, RememberPerson, RememberSearchResponse, RememberSession, RememberSpeaker, RememberStatus, RememberTranscript, RememberVoiceprint } from '../types';

const ROOT = '/api/remember/memory';

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
  setCluster: async (
    sessionId: string, cluster: number,
    action: 'confirm_new' | 'confirm_person' | 'reject' | 'set_me',
    opts?: { name?: string; personId?: number },
  ) =>
    apiRequest<{ session_id: string; cluster: number; status: string; person_id: number | null }>(
      `${ROOT}/clusters`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          session_id: sessionId, cluster, action,
          ...(opts?.name != null ? { name: opts.name } : {}),
          ...(opts?.personId != null ? { person_id: opts.personId } : {}),
        }),
      },
    ),
  getPeople: async () => apiRequest<RememberPerson[]>(`${ROOT}/people`),
  renamePerson: async (id: number, name: string) =>
    apiRequest<{ id: number; name: string }>(`${ROOT}/people/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  mergePeople: async (intoId: number, fromId: number) =>
    apiRequest<{ id: number }>(`${ROOT}/people/merge`, { method: 'POST', body: JSON.stringify({ into_id: intoId, from_id: fromId }) }),
  deletePerson: async (id: number) =>
    apiRequest<{ deleted: boolean }>(`${ROOT}/people/${id}`, { method: 'DELETE' }),
  backfillSpeakers: async (sessionId: string) =>
    apiRequest<{ embedded: number; missing_chunks: number }>(`${ROOT}/sessions/${encodeURIComponent(sessionId)}/backfill-speakers`, { method: 'POST' }),
  clusterSampleUrl: (segmentIds: number[]) => {
    const ids = segmentIds.filter((id) => Number.isInteger(id) && id > 0).join(',');
    return apiUrl(`${ROOT}/segments/audio?ids=${encodeURIComponent(ids)}`);
  },
  segmentAudioUrl: (segmentId: number) => apiUrl(`${ROOT}/segments/${segmentId}/audio`),
};

import { config } from '../config/index';
import { celtwoRequest, celtwoRequestRaw, CeltwoUnavailableError } from './celtwoClient';
import type { RememberDay, RememberPerson, RememberSearchResponse, RememberSession, RememberStatus, RememberTranscript, RememberVoiceprint } from './schemas';

const SP_TZ = 'America/Sao_Paulo';

/** Civil date parts for `at` as seen in São Paulo (the app is Brazil-only). */
function spParts(at: Date = new Date()): { year: number; month: number; iso: string } {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ }).format(at); // YYYY-MM-DD
  const [year, month] = iso.split('-').map(Number);
  return { year, month, iso };
}

/** São Paulo civil date (YYYY-MM-DD) of an absolute instant. */
function spDateOf(iso: string): string {
  return spParts(new Date(iso)).iso;
}

/**
 * Celtwo quirk: some sessions arrive with `started_at` as a São Paulo wall clock
 * carrying a bogus `Z` suffix — older capture builds (Celtwo device and early
 * phone-app) stamped local time and never converted it (e.g. a recording made
 * 08:39 local comes as `2026-08-31T08:39:33Z`). Left as-is, the frontend reads
 * it as UTC and shifts it another −3h, showing 05:39. Newer builds already stamp
 * a true UTC instant, and blindly reinterpreting those pushes them +3h into the
 * future.
 *
 * `ended_at` is always a real UTC instant (Celtwo sets it when the completion
 * POST lands), so `ended_at − duration_seconds` is the true start. We only
 * reinterpret `started_at` when it sits ~one SP offset *before* that true start;
 * when it already matches (or we lack `ended_at`/`duration_seconds` to tell), we
 * leave it untouched.
 */
function spTzOffsetMinutes(atUtcMs: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: SP_TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(atUtcMs))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-03:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return -180;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function spWallClockToInstant(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return value;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const guessMs = Date.UTC(y, mo - 1, d, h, mi, s);
  return new Date(guessMs - spTzOffsetMinutes(guessMs) * 60_000).toISOString();
}

/** How far `started_at` may drift from `ended_at − duration_seconds` and still
 *  count as "matches" (covers clock skew, trailing-silence trim, rounding). */
const CLOCK_MATCH_TOLERANCE_MS = 45 * 60_000;

/**
 * Resolve a session's real UTC `started_at`. Returns the raw value unchanged
 * unless it's the wall-clock-labelled-`Z` quirk (see `spTzOffsetMinutes` doc),
 * in which case it's reinterpreted in `SP_TZ`.
 */
function correctedStartedAt(s: { started_at: string; ended_at?: string | null; duration_seconds?: number }): string {
  const rawMs = Date.parse(s.started_at);
  if (Number.isNaN(rawMs)) return s.started_at;
  if (!s.ended_at || typeof s.duration_seconds !== 'number') return s.started_at;

  const endedMs = Date.parse(s.ended_at);
  if (Number.isNaN(endedMs)) return s.started_at;

  const expectedStartMs = endedMs - s.duration_seconds * 1000;
  const drift = expectedStartMs - rawMs; // > 0 when the raw start is earlier than reality
  if (Math.abs(drift) <= CLOCK_MATCH_TOLERANCE_MS) return s.started_at; // already a real UTC instant

  const offsetMs = -spTzOffsetMinutes(rawMs) * 60_000; // ~+3h for São Paulo
  if (Math.abs(drift - offsetMs) <= CLOCK_MATCH_TOLERANCE_MS) return spWallClockToInstant(s.started_at);

  return s.started_at; // ambiguous — don't guess
}

/** Normalize a session's `started_at` (and, when present, the derived `date`)
 *  into a fresh copy. Returns the original object when nothing needs fixing. */
function fixSessionClock<T extends { started_at: string; ended_at?: string | null; duration_seconds?: number; date?: string }>(s: T): T {
  const started_at = correctedStartedAt(s);
  if (started_at === s.started_at) return s;
  const next = { ...s, started_at };
  if (typeof s.date === 'string') next.date = spDateOf(started_at);
  return next;
}

/** Calendar-date arithmetic on a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Celtwo buckets sessions by the UTC date of `started_at`. This app shows the
 * timeline in São Paulo time (UTC−3), so a recording made after 21:00 local
 * lands in the *next* UTC bucket. These helpers re-bucket Celtwo's responses by
 * São Paulo date so the timeline day matches when the user actually recorded.
 */
async function fetchCeltwoDay(date: string): Promise<{ sessions: RememberSession[]; notAvailable: boolean }> {
  try {
    const day = await celtwoRequest<RememberDay>(`/days/${encodeURIComponent(date)}`);
    return { sessions: day.sessions ?? [], notAvailable: false };
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) {
      return { sessions: [], notAvailable: true };
    }
    throw error;
  }
}

async function fetchCeltwoMonthDays(year: number, month: number): Promise<string[]> {
  try {
    return await celtwoRequest<string[]>(`/years/${year}/months/${month}/days`);
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return [];
    throw error;
  }
}

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
    message: status.version ? `Serviço de gravação ${status.version}` : 'Serviço de gravação online',
  };
}

function mockStatus(userId: string): RememberStatus {
  const startedAt = mockStartedAt.get(userId) ?? null;
  return {
    state: startedAt ? 'recording' : 'stopped',
    started_at: startedAt,
    last_communication_at: new Date().toISOString(),
    device_id: 'android-recorder-mock',
    message: 'Modo de desenvolvimento',
  };
}

function offlineStatus(message = 'Serviço de gravação offline'): RememberStatus {
  return { state: 'offline', started_at: null, last_communication_at: cachedStatus?.last_communication_at ?? null, device_id: cachedStatus?.device_id ?? null, message };
}

export async function getRememberStatus(userId: string): Promise<RememberStatus> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return mockStatus(userId);
  if (config.CELTWO_MEMORY_MODE === 'offline') return offlineStatus('Serviço de gravação não configurado');
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
  if (config.CELTWO_MEMORY_MODE === 'offline') throw new CeltwoUnavailableError('Serviço de gravação offline');
  cachedStatus = await celtwoRequest<RememberStatus>(recording ? '/start' : '/stop', { method: 'POST' });
  cachedStatusAt = Date.now();
  return cachedStatus;
}

export async function getRememberYears(): Promise<number[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return [spParts().year];
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];
  try { return await celtwoRequest<number[]>('/years'); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberMonths(year: number): Promise<number[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') { const p = spParts(); return year === p.year ? [p.month] : []; }
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];
  try { return await celtwoRequest<number[]>(`/years/${year}/months`); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberDays(year: number, month: number): Promise<string[]> {
  if (config.CELTWO_MEMORY_MODE === 'mock') {
    const p = spParts();
    return year === p.year && month === p.month ? [p.iso] : [];
  }
  if (config.CELTWO_MEMORY_MODE === 'offline') return [];

  // Celtwo groups by UTC date; a São Paulo day (UTC−3) draws from UTC buckets
  // `d` and `d`+1. Read every UTC bucket Celtwo reports for this month — plus
  // the 1st of next month, which can hold early-hours sessions still belonging
  // to this month in SP — and place each session on its real São Paulo date.
  const { year: ny, month: nm } = nextMonth(year, month);
  const [thisMonthDays, nextMonthDays] = await Promise.all([
    fetchCeltwoMonthDays(year, month),
    fetchCeltwoMonthDays(ny, nm),
  ]);
  const firstOfNext = `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
  const buckets = [...thisMonthDays];
  if (nextMonthDays.includes(firstOfNext)) buckets.push(firstOfNext);

  const days = await Promise.all(buckets.map((d) => fetchCeltwoDay(d)));
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`;
  const spDates = new Set<string>();
  for (const { sessions } of days) {
    for (const s of sessions) {
      const d = spDateOf(correctedStartedAt(s));
      if (d.startsWith(prefix)) spDates.add(d);
    }
  }
  return [...spDates].sort().reverse();
}

export async function getRememberDay(date: string): Promise<RememberDay> {
  if (config.CELTWO_MEMORY_MODE === 'mock') return { date, total_seconds: 0, session_count: 0, sessions: [] };
  if (config.CELTWO_MEMORY_MODE === 'offline') return { date, total_seconds: 0, session_count: 0, sessions: [] };

  // A São Paulo day (UTC−3) spans two of Celtwo's UTC buckets: `date` and `date`+1.
  const [primary, spill] = await Promise.all([fetchCeltwoDay(date), fetchCeltwoDay(addDays(date, 1))]);

  const seen = new Set<string>();
  const sessions = [...primary.sessions, ...spill.sessions]
    .map(fixSessionClock)
    .filter((s) => spDateOf(s.started_at) === date)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));

  const total_seconds = sessions.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0);
  const day: RememberDay = { date, total_seconds, session_count: sessions.length, sessions };

  if (primary.notAvailable && sessions.length === 0) {
    day.history_available = false;
    day.message = 'O serviço de gravação está online, mas o histórico temporal ainda não está disponível nesta versão.';
  }
  return day;
}

export async function getRememberSessions(date?: string): Promise<RememberSession[]> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return [];
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  try { return (await celtwoRequest<RememberSession[]>(`/sessions${query}`)).map(fixSessionClock); }
  catch (error) { if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return []; throw error; }
}

export async function getRememberTranscript(sessionId: string): Promise<RememberTranscript> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { session_id: sessionId, status: 'ready', text: null };
  return celtwoRequest<RememberTranscript>(`/sessions/${encodeURIComponent(sessionId)}/transcript`);
}

export async function getRememberSearch(q: string, limit?: number, speaker?: string): Promise<RememberSearchResponse> {
  const query = q.trim();
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { query, results: [] };
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  if (speaker) params.set('speaker', speaker);
  try {
    // Search hits carry no `ended_at`/`duration_seconds`, so the wall-clock quirk
    // can't be told apart from a correct UTC instant here — pass `started_at`
    // through untouched (modern captures are already correct).
    return await celtwoRequest<RememberSearchResponse>(`/search?${params.toString()}`);
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return { query, results: [] };
    throw error;
  }
}

const EMPTY_VOICEPRINT: RememberVoiceprint = { enrolled: false, updated_at: null, sample_seconds: null, model: null };

export async function getRememberVoiceprint(): Promise<RememberVoiceprint> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return EMPTY_VOICEPRINT;
  try {
    return await celtwoRequest<RememberVoiceprint>('/voiceprint');
  } catch (error) {
    if (error instanceof CeltwoUnavailableError && error.statusCode === 404) return EMPTY_VOICEPRINT;
    throw error;
  }
}

interface EnrollResult { enrolled: boolean; sample_seconds: number | null; model: string | null }

export async function enrollRememberVoiceprint(body: Buffer, contentType: string): Promise<EnrollResult> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest<EnrollResult>(`/voiceprint`, { method: 'POST', body, headers: { 'Content-Type': contentType } });
}

export async function deleteRememberVoiceprint(): Promise<{ enrolled: boolean }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { enrolled: false };
  return celtwoRequest<{ enrolled: boolean }>(`/voiceprint`, { method: 'DELETE' });
}

export async function enrollRememberVoiceprintFromSession(sessionId: string): Promise<EnrollResult> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest<EnrollResult>(`/voiceprint/from-session/${encodeURIComponent(sessionId)}`, { method: 'POST' });
}

export async function setRememberSegmentsSpeaker(segmentIds: number[], speaker: string | null): Promise<{ updated: number }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return { updated: 0 };
  return celtwoRequest<{ updated: number }>(`/segments`, {
    method: 'PATCH',
    body: JSON.stringify({ segment_ids: segmentIds, speaker }),
  });
}

export async function setRememberCluster(body: {
  session_id: string; cluster: number; action: string; name?: string; person_id?: number;
}): Promise<{ session_id: string; cluster: number; status: string; person_id: number | null }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest('/clusters', { method: 'PATCH', body: JSON.stringify(body) });
}

export async function getRememberPeople(): Promise<RememberPerson[]> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') return [];
  // Não engolir o 404: se este Celtwo não tem /people, o frontend precisa
  // distinguir "sem pessoas" de "recurso indisponível nesta versão".
  return celtwoRequest<RememberPerson[]>('/people');
}

export async function renameRememberPerson(id: number, name: string): Promise<{ id: number; name: string }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest(`/people/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export async function mergeRememberPeople(intoId: number, fromId: number): Promise<{ id: number }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest('/people/merge', { method: 'POST', body: JSON.stringify({ into_id: intoId, from_id: fromId }) });
}

export async function deleteRememberPerson(id: number): Promise<{ deleted: boolean }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequest(`/people/${id}`, { method: 'DELETE' });
}

export async function getRememberSegmentAudio(segmentId: number): Promise<Response> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  return celtwoRequestRaw(`/segments/${encodeURIComponent(String(segmentId))}/audio`);
}

export async function getRememberClusterSampleAudio(segmentIds: number[]): Promise<Response> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  const ids = segmentIds.join(',');
  return celtwoRequestRaw(`/segments/audio?ids=${encodeURIComponent(ids)}`);
}

export async function backfillRememberSpeakers(sessionId: string): Promise<{ embedded: number; missing_chunks: number }> {
  if (config.CELTWO_MEMORY_MODE !== 'proxy') throw new CeltwoUnavailableError('Serviço de gravação offline');
  // Re-embeda o áudio inteiro da sessão num Raspberry Pi — bem além dos 5s padrão.
  return celtwoRequest(`/sessions/${encodeURIComponent(sessionId)}/backfill-speakers`, { method: 'POST' }, 120000);
}

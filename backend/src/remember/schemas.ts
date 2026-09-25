export type RememberCaptureState = 'recording' | 'stopped' | 'offline' | 'syncing' | 'processing' | 'transcribing';

export interface RememberStatus {
  state: RememberCaptureState;
  started_at: string | null;
  last_communication_at: string | null;
  device_id: string | null;
  message?: string;
}

export interface RememberSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  device_id: string | null;
  status: 'recording' | 'syncing' | 'processing' | 'transcribing' | 'ready' | 'error';
  text: string | null;
  duration_seconds?: number;
  turns?: RememberTurn[];
  speakers?: RememberSpeakerCluster[];
}

export interface RememberDay {
  date: string;
  total_seconds: number;
  session_count: number;
  sessions: RememberSession[];
  history_available?: boolean;
  message?: string;
}

export interface RememberTranscript {
  session_id: string;
  status: RememberSession['status'];
  text: string | null;
  turns?: RememberTurn[];
}

export type RememberSpeaker = 'me' | 'other' | 'unknown';

export interface RememberTurn {
  speaker: RememberSpeaker | null;
  text: string;
  segment_ids?: number[];
  cluster?: number | null;
  start_ms?: number;
  end_ms?: number;
}

export interface RememberSpeakerCluster {
  cluster: number;
  status: 'pending' | 'confirmed';
  person_id: number | null;
  name: string | null;
  is_me: boolean;
  suggested: { person_id: number; name: string; score: number } | null;
  sample_segment_id: number | null;
  sample_segment_ids?: number[];
  total_ms: number;
  turn_count: number;
}

export interface RememberPerson {
  id: number;
  name: string;
  is_me: boolean;
  sample_seconds: number;
  segment_count: number;
  session_count: number;
  sample_segment_id: number | null;
  sample_segment_ids?: number[];
  updated_at: string;
}

export interface RememberVoiceprint {
  enrolled: boolean;
  updated_at: string | null;
  sample_seconds: number | null;
  model: string | null;
}

export interface RememberSearchResult {
  session_id: string;
  date: string;
  started_at: string;
  status: RememberSession['status'];
  snippet: string;
  match_count: number;
}

export interface RememberSearchResponse {
  query: string;
  results: RememberSearchResult[];
}

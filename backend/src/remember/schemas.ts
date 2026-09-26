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
  turns?: RememberTurn[];
  progress?: { total: number; done: number; processing: number; pending: number; failed: number; percent: number; models?: string[] };
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
  progress?: RememberSession['progress'];
}

export type RememberSpeaker = 'me' | 'other' | 'unknown';

export interface RememberTurn {
  id?: number;
  speaker: RememberSpeaker | null;
  text: string;
  start_at?: string | null;
  end_at?: string | null;
}

export interface RememberVoiceprint {
  enrolled: boolean;
  updated_at: string | null;
  sample_seconds: number | null;
  model: string | null;
  relabel?: { pending: number; processing: number; failed: number };
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

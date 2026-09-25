export interface PageSummary {
  id: string;
  parent_page_id?: string | null;
  title: string;
  slug: string;
  type: 'note' | 'infinite';
  icon?: string | null;
  is_section?: boolean;
  tags?: string[];
  status?: string | null;
  due_date?: string | null;
  working_directory?: string | null;
  sort_order: number;
  updated_at: string;
}

export interface Page extends PageSummary {
  type: 'note' | 'infinite';
  content: TiptapDoc | InfiniteDoc;
  markdown_source?: string;
  cover_url?: string | null;
  cover_position_y?: number;
}

export interface PageReferences {
  incoming: PageSummary[];
  outgoing: PageSummary[];
}

export interface PageVersion {
  id: string;
  page_id: string;
  title: string;
  reason: string;
  content_hash: string;
  created_at: string;
  content?: TiptapDoc | InfiniteDoc;
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface InfiniteDoc {
  tldraw: true;
  version: number;
  data: unknown;
}

export interface TreePage extends PageSummary {
  children: TreePage[];
}

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  created_by: string;
  created_at: string;
}

export interface RememberChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface RememberNote {
  id: string;
  title: string;
  body: string;
  color: 'sand' | 'rose' | 'sage' | 'sky' | 'amber' | 'lavender' | 'slate';
  checklist: RememberChecklistItem[];
  tags: string[];
  reminder_date: string | null;
  reminder_time?: string | null;
  reminder_label: string | null;
  reminder_repeat_daily?: boolean;
  reminder_sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface RememberTranscript {
  session_id: string;
  status: RememberSession['status'];
  text: string | null;
  turns?: RememberTurn[];
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

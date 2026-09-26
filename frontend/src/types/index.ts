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
  revision: number;
  type: 'note' | 'infinite';
  content: TiptapDoc | InfiniteDoc;
  markdown_source?: string;
  cover_url?: string | null;
  cover_position_y?: number;
}

export type PageShareRole = 'owner' | 'editor' | 'viewer';

export interface SharedPageSummary {
  id: string;
  title: string;
  slug: string;
  type: 'note' | 'infinite';
  icon?: string | null;
  updated_at: string;
  revision?: number;
  role: Exclude<PageShareRole, 'owner'> | PageShareRole;
  last_edited_at?: string | null;
  last_editor?: string | null;
  grantees?: PageGrant[];
}

export interface PageGrant {
  user_id: string;
  email?: string | null;
  name?: string | null;
  role: 'editor' | 'viewer';
  granted_at?: string;
}

export interface ContactSummary {
  id: string;
  name: string | null;
  email: string;
}

export interface ContactLists {
  contacts: ContactSummary[];
  incoming: ContactSummary[];
  outgoing: ContactSummary[];
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
  author_user_id?: string | null;
  author_name?: string | null;
  page_revision?: number | null;
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

export interface RememberTranscript {
  session_id: string;
  status: RememberSession['status'];
  text: string | null;
  turns?: RememberTurn[];
  progress?: RememberSession['progress'];
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

export interface Page {
  id: string;
  parent_page_id?: string | null;
  title: string;
  slug: string;
  type: 'note' | 'infinite';
  content: TiptapDoc | InfiniteDoc;
  markdown_source?: string;
  icon?: string | null;
  cover_url?: string | null;
  cover_position_y?: number;
  tags?: string[];
  status?: string | null;
  due_date?: string | null;
  working_directory?: string | null;
  is_section?: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

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
  deleted_at?: string | null;
}

export interface PageVersion {
  id: string;
  page_id: string;
  title: string;
  content: TiptapDoc | InfiniteDoc;
  reason: string;
  content_hash: string;
  created_at: string;
}

export interface InfiniteDoc {
  tldraw: true;
  version: number;
  data: unknown;
}

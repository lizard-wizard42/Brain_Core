export interface Page {
  id: string;
  parent_page_id?: string | null;
  title: string;
  slug: string;
  type: 'note' | 'infinite' | 'notebook';
  content: TiptapDoc | InfiniteDoc | NotebookDoc;
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
  type: 'note' | 'infinite' | 'notebook';
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
  content: TiptapDoc | InfiniteDoc | NotebookDoc;
  reason: string;
  content_hash: string;
  created_at: string;
}

export interface InfiniteDoc {
  tldraw: true;
  version: number;
  data: unknown;
}

/** Fixed-size sheets; backgrounds are independent from editable ink and text. */
export type NotebookPaper = 'blank' | 'ruled' | 'grid' | 'dots' | 'oxford';
export interface InkPoint { x: number; y: number; pressure: number }
export interface NotebookStroke {
  id: string; tool: 'pen' | 'highlighter'; color: string; width: number; points: InkPoint[];
}
export interface NotebookText {
  id: string; x: number; y: number; width: number; text: string; color: string; fontSize: number;
}
export interface NotebookSheet {
  id: string; paper: NotebookPaper; spacing: number; tint: string;
  strokes: NotebookStroke[]; texts: NotebookText[];
}
export interface NotebookDoc { notebook: true; version: 1; sheets: NotebookSheet[] }

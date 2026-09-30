

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '') || `page-${Date.now()}`;
}

export function isCustomIconUrl(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && /^\/|^https?:\/\//.test(icon);
}

export function renderPageIcon(icon: string | null | undefined, fallback = '📄') {
  if (isCustomIconUrl(icon)) {
    return (
      <img
        src={icon as string}
        alt="Ícone da página"
        className="w-full h-full object-contain rounded"
      />
    );
  }
  return icon || fallback;
}


export function computeSavePayloadHash(content: unknown, title: string): string {
  return JSON.stringify({ content, title });
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface ViewReadyEditor {
  isInitialized: boolean;
  isDestroyed: boolean;
  on: (event: 'create', handler: () => void) => unknown;
  off: (event: 'create', handler: () => void) => unknown;
}

/**
 * Tiptap 3 only exposes `editor.view.dom` after the editor is mounted; before that,
 * `editor.view` is a proxy that throws on `.dom`. Run `fn` as soon as the view exists
 * (immediately when it already does) and return a cleanup that cancels a pending run.
 */
export function whenEditorViewReady(editor: ViewReadyEditor, fn: () => void): () => void {
  if (editor.isInitialized) {
    if (!editor.isDestroyed) fn();
    return () => undefined;
  }
  const onCreate = () => {
    if (!editor.isDestroyed) fn();
  };
  editor.on('create', onCreate);
  return () => { editor.off('create', onCreate); };
}

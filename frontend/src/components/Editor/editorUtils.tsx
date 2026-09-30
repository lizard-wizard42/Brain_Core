

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

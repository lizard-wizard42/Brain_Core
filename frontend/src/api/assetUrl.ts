// Resolves a stored /uploads path (with or without a legacy baked-in base prefix)
// to an absolute URL under the currently active VITE_BASE.
export function resolveAssetUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith('http')) return rawUrl;

  const apiHost = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = apiHost || window.location.origin;

  // Strip any single leading path segment (legacy base prefix, whatever it was
  // at upload time) before /uploads, then re-prefix with the currently active base.
  const match = rawUrl.match(/^\/[^/]*(\/uploads\/.*)$/);
  if (match) {
    return `${origin}${base}${match[1]}`;
  }
  if (rawUrl.startsWith('/uploads')) {
    return `${origin}${base}${rawUrl}`;
  }
  return rawUrl;
}

// Attachment URLs come from stored editor content, which may be shared by another
// user. Only serve files through this application's authenticated uploads route.
export function resolveAttachmentUrl(rawUrl: string): string | null {
  if (!rawUrl || [...rawUrl].some(char => char.charCodeAt(0) <= 32 || char === '\\') || rawUrl.includes('?') || rawUrl.includes('#')) return null;

  let path = rawUrl;
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.origin !== window.location.origin || parsed.username || parsed.password) return null;
      path = rawUrl.match(/^https?:\/\/[^/]+(\/.*)$/i)?.[1] ?? '';
    } catch {
      return null;
    }
  }

  const match = path.match(/^\/(?:[^/]+\/)?uploads\/(.+)$/);
  if (!match) return null;
  const segments = match[1].split('/');
  if (segments.some(segment => {
    try {
      const decoded = decodeURIComponent(segment);
      return !decoded || decoded === '.' || decoded === '..' || [...decoded].some(char =>
        char.charCodeAt(0) < 32 || '/\\?#'.includes(char));
    } catch {
      return true;
    }
  })) return null;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/uploads/${match[1]}`;
}

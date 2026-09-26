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

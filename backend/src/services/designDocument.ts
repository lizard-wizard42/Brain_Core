/** Design pages use the same tldraw snapshot envelope as Infinite, but are a separate page type. */
export function validDesignDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  if (doc.tldraw !== true || doc.version !== 1 || !('data' in doc)) return false;
  if (Object.keys(doc).some(key => !['tldraw', 'version', 'data'].includes(key))) return false;
  if (doc.data !== null) {
    if (typeof doc.data !== 'object' || Array.isArray(doc.data)) return false;
    const snapshot = doc.data as Record<string, unknown>;
    if (!snapshot.document || typeof snapshot.document !== 'object' || Array.isArray(snapshot.document) ||
        !snapshot.session || typeof snapshot.session !== 'object' || Array.isArray(snapshot.session)) return false;
    const document = snapshot.document as Record<string, unknown>;
    const session = snapshot.session as Record<string, unknown>;
    if (!document.store || typeof document.store !== 'object' || Array.isArray(document.store) ||
        !document.schema || typeof document.schema !== 'object' || Array.isArray(document.schema) ||
        typeof (document.schema as Record<string, unknown>).schemaVersion !== 'number' ||
        typeof session.version !== 'number') return false;
    const schema = document.schema as Record<string, unknown>;
    const store = document.store as Record<string, unknown>;
    if (!schema.sequences || typeof schema.sequences !== 'object' || Array.isArray(schema.sequences) ||
        !store['document:document'] || typeof store['document:document'] !== 'object' ||
        (store['document:document'] as Record<string, unknown>).typeName !== 'document') return false;
    let pageCount = 0;
    for (const [key, value] of Object.entries(store)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      if (record.id !== key || typeof record.typeName !== 'string') return false;
      if (record.typeName === 'page') pageCount++;
    }
    if (pageCount === 0) return false;
    if (session.currentPageId !== undefined && (typeof session.currentPageId !== 'string' ||
        (store[session.currentPageId] as Record<string, unknown> | undefined)?.typeName !== 'page')) return false;
  }
  try { return Buffer.byteLength(JSON.stringify(doc)) <= 32 * 1024 * 1024; }
  catch { return false; }
}

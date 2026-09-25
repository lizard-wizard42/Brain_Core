import type { RememberStatus } from '../../types';

export const REMEMBER_STATUS_EVENT = 'brain-core:remember-status';

/** Broadcasts a fresh capture status so other Remember views (timeline, sidebar) can react. */
export function emitRememberStatus(status: RememberStatus): void {
  window.dispatchEvent(new CustomEvent<RememberStatus>(REMEMBER_STATUS_EVENT, { detail: status }));
}

/** Subscribes to capture status broadcasts. Returns an unsubscribe function. */
export function onRememberStatus(handler: (status: RememberStatus) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<RememberStatus>).detail);
  window.addEventListener(REMEMBER_STATUS_EVENT, listener);
  return () => window.removeEventListener(REMEMBER_STATUS_EVENT, listener);
}

/** Session/capture states that are still expected to change on the Celtwo side. */
export const REMEMBER_PENDING_STATES = new Set(['recording', 'syncing', 'processing', 'transcribing']);

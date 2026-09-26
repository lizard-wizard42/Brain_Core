import { disconnectAppSocket } from '../hooks/useSocket';

const ACTIVE_USER_KEY = 'brain-core:active-user-id';
const WORKSPACE_KEYS = ['brain-core-tabs', 'brain-core:sidebar-open'];

export function activeBrowserUserId(): string | null {
  return window.localStorage.getItem(ACTIVE_USER_KEY);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === ACTIVE_USER_KEY && event.oldValue !== event.newValue) {
      // Cookies are shared by browser tabs; discard any mounted view of the old user.
      window.location.reload();
    }
  });
}

function clearWorkspace(): void {
  disconnectAppSocket();
  for (const key of WORKSPACE_KEYS) window.localStorage.removeItem(key);
  window.dispatchEvent(new Event('brain-core:session-ended'));
}

/** Drop persisted UI from a different account before mounting private pages. */
export function prepareBrowserSession(userId: string): void {
  const previousUserId = window.localStorage.getItem(ACTIVE_USER_KEY);
  if (previousUserId !== userId) clearWorkspace();
  window.localStorage.setItem(ACTIVE_USER_KEY, userId);
}

export function clearBrowserSession(): void {
  clearWorkspace();
  window.localStorage.removeItem(ACTIVE_USER_KEY);
}

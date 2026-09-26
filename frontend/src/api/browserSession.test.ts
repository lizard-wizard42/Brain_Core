import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBrowserSession, prepareBrowserSession } from './browserSession';

describe('browser session isolation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears tabs and sidebar state when another account logs in', () => {
    prepareBrowserSession('user-a');
    localStorage.setItem('brain-core-tabs', '[{"title":"private A"}]');
    localStorage.setItem('brain-core:sidebar-open', '["page-a"]');
    const ended = vi.fn();
    window.addEventListener('brain-core:session-ended', ended, { once: true });

    prepareBrowserSession('user-b');

    expect(localStorage.getItem('brain-core-tabs')).toBeNull();
    expect(localStorage.getItem('brain-core:sidebar-open')).toBeNull();
    expect(ended).toHaveBeenCalledOnce();
  });

  it('keeps the same account state on reload and clears it on logout', () => {
    prepareBrowserSession('user-a');
    localStorage.setItem('brain-core-tabs', '[{"title":"own tab"}]');
    prepareBrowserSession('user-a');
    expect(localStorage.getItem('brain-core-tabs')).toContain('own tab');

    clearBrowserSession();
    expect(localStorage.getItem('brain-core-tabs')).toBeNull();
    expect(localStorage.getItem('brain-core:active-user-id')).toBeNull();
  });
});

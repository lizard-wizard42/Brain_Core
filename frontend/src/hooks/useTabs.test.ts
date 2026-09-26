import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabs } from './useTabs';
import { api } from '../api/client';
import { closeTerminalSessionForRequestKey } from '../components/Terminal/terminalSessionRegistry';

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/', search: '' };

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('../components/Terminal/terminalSessionRegistry', () => ({
  closeTerminalSessionForRequestKey: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: {
    listTerminalTabs: vi.fn(),
  },
}));

describe('useTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation.pathname = '/';
    mockLocation.search = '';
    vi.mocked(api.listTerminalTabs).mockResolvedValue({ tabs: [] } as never);
  });

  it('opens and closes a regular tab', async () => {
    const { result } = renderHook(() => useTabs());
    await waitFor(() => expect(api.listTerminalTabs).toHaveBeenCalled());

    act(() => {
      result.current.openTab({ id: 'p1', title: 'Page 1', path: '/page/p1' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/page/p1');
    expect(result.current.tabs.some((t) => t.id === 'p1')).toBe(true);

    act(() => {
      result.current.closeTab('p1');
    });

    expect(result.current.tabs.some((t) => t.id === 'p1')).toBe(false);
  });

  it('closes terminal session when closing terminal tab', async () => {
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-1', title: 'Term', cwd: '/tmp', is_active: true, last_seen_at: '' }],
    } as never);
    mockLocation.pathname = '/terminal/req-1';
    mockLocation.search = '?title=Term&cwd=%2Ftmp';

    const { result } = renderHook(() => useTabs());

    await waitFor(() => expect(result.current.tabs.some((t) => t.id === 'req-1')).toBe(true));

    act(() => {
      result.current.closeTab('req-1');
    });

    expect(closeTerminalSessionForRequestKey).toHaveBeenCalledWith('req-1');
  });

  it('restores active terminal route on desktop when on home', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-2', title: 'Dev', cwd: '/work', is_active: true, last_seen_at: '' }],
    } as never);

    renderHook(() => useTabs());

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/terminal/req-2?title=Dev&cwd=%2Fwork', { replace: true })
    );
  });

  it('closeAllTabs clears tabs and terminal sessions', async () => {
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-3', title: 'Ops', cwd: null, is_active: false, last_seen_at: '' }],
    } as never);

    const { result } = renderHook(() => useTabs());
    await waitFor(() => expect(result.current.tabs.length).toBe(1));

    act(() => {
      result.current.openTab({ id: 'p2', title: 'Page 2', path: '/page/p2' });
    });

    act(() => {
      result.current.closeAllTabs();
    });

    expect(closeTerminalSessionForRequestKey).toHaveBeenCalledWith('req-3');
    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(result.current.tabs).toEqual([]);
  });

  it('setActiveTab and newTab navigate as expected', async () => {
    const { result } = renderHook(() => useTabs());
    await waitFor(() => expect(api.listTerminalTabs).toHaveBeenCalled());

    act(() => {
      result.current.openTab({ id: 'p9', title: 'Page 9', path: '/page/p9' });
      result.current.setActiveTab('p9');
      result.current.newTab();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/page/p9');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('returns through the active tab history without creating another tab', async () => {
    const { result, rerender } = renderHook(() => useTabs());
    await waitFor(() => expect(api.listTerminalTabs).toHaveBeenCalled());

    act(() => { result.current.openTab({ id: 'a', title: 'Page A', path: '/page/a' }); });
    mockLocation.pathname = '/page/a';
    rerender();
    act(() => { result.current.replaceActiveTab({ id: 'b', title: 'Page B', path: '/page/b' }); });
    mockLocation.pathname = '/page/b';
    rerender();

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].history).toEqual(['/page/a', '/page/b']);
    act(() => { result.current.goBack(); });
    expect(mockNavigate).toHaveBeenCalledWith('/page/a');
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].historyIndex).toBe(0);
  });

  it('deduplicates restored tabs and closes the current route to a distinct tab', async () => {
    localStorage.setItem('brain-core-tabs', JSON.stringify([
      { id: 'remember', title: 'Memória', path: '/remember' },
      { id: 'remember', title: 'Memória', path: '/remember?date=2026-09-23' },
      { id: 'other', title: 'Outra', path: '/page/other' },
    ]));
    mockLocation.pathname = '/remember';
    const { result } = renderHook(() => useTabs());
    await waitFor(() => expect(api.listTerminalTabs).toHaveBeenCalled());
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['remember', 'other']);
    act(() => result.current.closeTab('remember'));
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['other']);
    expect(mockNavigate).toHaveBeenCalledWith('/page/other');
  });
});

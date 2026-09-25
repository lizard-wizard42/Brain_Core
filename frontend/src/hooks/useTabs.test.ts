import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeTerminalTabTitle, useTabs } from './useTabs';
import { api } from '../api/client';
import { closeTerminalSessionForRequestKey } from '../components/Terminal/terminalSessionRegistry';

const mockNavigate = vi.fn();
const mockLocation = { pathname: '/', search: '' };
const TERMINAL_ENABLED = import.meta.env.VITE_TERMINAL_ENABLED === 'true';

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

async function waitForTabsInitialization(): Promise<void> {
  if (TERMINAL_ENABLED) {
    await waitFor(() => expect(api.listTerminalTabs).toHaveBeenCalled());
    return;
  }
  await act(async () => Promise.resolve());
}

describe('useTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation.pathname = '/';
    mockLocation.search = '';
    vi.mocked(api.listTerminalTabs).mockResolvedValue({ tabs: [] } as any);
  });

  it('opens and closes a regular tab', async () => {
    const { result } = renderHook(() => useTabs());
    await waitForTabsInitialization();

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

  it('replaces legacy built-in remote icons when restoring tabs', async () => {
    localStorage.setItem('brain-core-tabs', JSON.stringify([{
      id: 'remember',
      title: 'Memória',
      path: '/remember',
      icon: 'https://img.icons8.com/?size=100&id=55fqUsmHwQDN&format=png&color=000000',
    }]));

    const { result } = renderHook(() => useTabs());
    await waitForTabsInitialization();

    expect(result.current.tabs[0].icon).toBeTruthy();
    expect(result.current.tabs[0].icon).not.toContain('img.icons8.com');
  });

  it('replaces malformed persisted terminal titles with a safe fallback', () => {
    expect(normalizeTerminalTabTitle("=44%20height='50%20rx='7")).toBe('Terminal');
    expect(normalizeTerminalTabTitle('<svg viewBox="0 0 24 24">')).toBe('Terminal');
    expect(normalizeTerminalTabTitle('  Workspace  ')).toBe('Workspace');
  });

  it.runIf(TERMINAL_ENABLED)('closes terminal session when closing terminal tab', async () => {
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-1', title: 'Term', cwd: '/tmp', is_active: true, last_seen_at: '' }],
    } as any);
    mockLocation.pathname = '/terminal/req-1';
    mockLocation.search = '?title=Term&cwd=%2Ftmp';

    const { result } = renderHook(() => useTabs());

    await waitFor(() => expect(result.current.tabs.some((t) => t.id === 'req-1')).toBe(true));

    act(() => {
      result.current.closeTab('req-1');
    });

    expect(closeTerminalSessionForRequestKey).toHaveBeenCalledWith('req-1');
  });

  it.runIf(TERMINAL_ENABLED)('restores active terminal route on desktop when on home', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-2', title: 'Dev', cwd: '/work', is_active: true, last_seen_at: '' }],
    } as any);

    renderHook(() => useTabs());

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/terminal/req-2?title=Dev&cwd=%2Fwork', { replace: true })
    );
  });

  it.runIf(TERMINAL_ENABLED)('closeAllTabs clears tabs and terminal sessions', async () => {
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-3', title: 'Ops', cwd: null, is_active: false, last_seen_at: '' }],
    } as any);

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
    await waitForTabsInitialization();

    act(() => {
      result.current.openTab({ id: 'p9', title: 'Page 9', path: '/page/p9' });
      result.current.setActiveTab('p9');
      result.current.newTab();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/page/p9');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('keeps the active tab resolvable after going back', async () => {
    const { result, rerender } = renderHook(() => useTabs());
    await waitForTabsInitialization();

    act(() => { result.current.openTab({ id: 'a', title: 'Page A', path: '/page/a' }); });
    mockLocation.pathname = '/page/a';
    rerender();
    act(() => { result.current.replaceActiveTab({ id: 'b', title: 'Page B', path: '/page/b' }); });
    mockLocation.pathname = '/page/b';
    rerender();

    act(() => { result.current.goBack(); });
    mockLocation.pathname = '/page/a';
    rerender();

    // The tab keeps its id ('b'); what matters is that it still resolves as
    // active after goBack instead of falling through to null.
    expect(result.current.activeTabId).toBe('b');

    act(() => { result.current.closeTab('b'); });
    expect(mockNavigate).toHaveBeenLastCalledWith('/');
    expect(result.current.tabs).toHaveLength(0);
  });

  it('resolves the active home tab by its tab query param', async () => {
    const { result, rerender } = renderHook(() => useTabs());
    await waitForTabsInitialization();

    act(() => {
      result.current.openTab({ id: 'h1', title: 'Início', path: '/?tab=h1' });
      result.current.openTab({ id: 'h2', title: 'Início', path: '/?tab=h2' });
    });
    mockLocation.pathname = '/';
    mockLocation.search = '?tab=h2';
    rerender();

    expect(result.current.activeTabId).toBe('h2');
  });

  it('returns through the active tab history without creating another tab', async () => {
    const { result, rerender } = renderHook(() => useTabs());
    await waitForTabsInitialization();

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

  it.runIf(!TERMINAL_ENABLED)('nao consulta nem restaura abas de terminal quando o recurso esta desligado', async () => {
    vi.mocked(api.listTerminalTabs).mockResolvedValueOnce({
      tabs: [{ request_key: 'req-off', title: 'Nao restaurar', cwd: '/tmp', is_active: true, last_seen_at: '' }],
    } as any);

    const { result } = renderHook(() => useTabs());

    await waitFor(() => expect(result.current.tabs).toEqual([]));
    expect(api.listTerminalTabs).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/terminal/'), expect.anything());
  });
});

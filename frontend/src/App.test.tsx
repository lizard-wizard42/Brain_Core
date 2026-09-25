import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { isAuthenticated: true };
const openTabSpy = vi.fn();
const closeTabSpy = vi.fn();
const setActiveTabSpy = vi.fn();
const refreshSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('./api/client', () => ({
  api: {
    isAuthenticated: () => authState.isAuthenticated,
    getPage: vi.fn().mockResolvedValue({ id: 'p1', title: 'Page 1', type: 'note' }),
    getMe: vi.fn().mockResolvedValue({ id: 'u1', email: 'user@example.test', name: 'Ana' }),
    getTree: vi.fn().mockResolvedValue({ pages: [] }),
    listRememberNotes: vi.fn().mockResolvedValue({ notes: [] }),
  },
}));

vi.mock('./services/rememberService', () => ({
  rememberService: {
    getDay: vi.fn().mockResolvedValue({ date: '2026-08-27', total_seconds: 0, session_count: 0, sessions: [] }),
    getSessions: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({ state: 'stopped', started_at: null, last_communication_at: null, device_id: null }),
  },
}));

vi.mock('./hooks/useTree', () => ({
  useTree: () => ({
    tree: [],
    loading: false,
    refresh: refreshSpy,
  }),
}));

vi.mock('./hooks/useTabs', () => ({
  useTabs: () => ({
    tabs: [],
    activeTabId: null,
    openTab: openTabSpy,
    closeTab: closeTabSpy,
    setActiveTab: setActiveTabSpy,
  }),
}));

vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: () => <div>Sidebar Mock</div>,
}));

vi.mock('./components/Editor/Editor', () => ({
  Editor: () => <div>Editor Mock</div>,
}));

vi.mock('./components/Tabs/Tabs', () => ({
  Tabs: () => <div>Tabs Mock</div>,
}));

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>Login Mock</div>,
}));

vi.mock('./pages/SettingsPage', () => ({
  SettingsPage: () => <div>Settings Mock</div>,
}));

vi.mock('./pages/RememberPage', () => ({
  RememberPage: () => <div>Remember Mock</div>,
}));

vi.mock('./components/Infinite/InfiniteRenderer', () => ({
  InfiniteRenderer: () => <div>Infinite Mock</div>,
}));

vi.mock('./components/Terminal/TerminalDrawer', () => ({
  TerminalDrawer: ({ request }: { request?: { title?: string } }) => <div>Terminal Mock {request?.title}</div>,
}));

import App from './App';

const TERMINAL_ENABLED = import.meta.env.VITE_TERMINAL_ENABLED === 'true';

describe('App routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renderiza login quando rota for /login', async () => {
    window.history.pushState({}, '', '/login');
    render(<App />);

    expect(await screen.findByText('Login Mock')).toBeInTheDocument();
  });

  it('protege settings quando nao autenticado', async () => {
    authState.isAuthenticated = false;
    window.history.pushState({}, '', '/settings');

    render(<App />);

    expect(await screen.findByText('Login Mock')).toBeInTheDocument();
  });

  it('mostra o dashboard na home', async () => {
    render(<App />);
    expect(await screen.findByText(/, Ana/)).toBeInTheDocument();
    expect(screen.getByText('Total de Notas')).toBeInTheDocument();
  });

  it('registra a aba Memória ao entrar em /remember', async () => {
    window.history.pushState({}, '', '/remember');
    render(<App />);

    expect(await screen.findByText('Remember Mock')).toBeInTheDocument();
    await waitFor(() => expect(openTabSpy).toHaveBeenCalled());
    expect(openTabSpy.mock.calls[0][0]).toMatchObject({ id: 'remember', title: 'Memória', path: '/remember' });
  });

  it.runIf(TERMINAL_ENABLED)('abre rota de terminal e registra aba correspondente', async () => {
    window.history.pushState({}, '', '/terminal/abc?title=Meu%20Terminal&cwd=%2Ftmp');
    render(<App />);

    expect(await screen.findByText('Terminal Mock Meu Terminal')).toBeInTheDocument();
    await waitFor(() => expect(openTabSpy).toHaveBeenCalled());
    expect(openTabSpy.mock.calls[0][0]).toMatchObject({
      id: 'abc',
      title: 'Meu Terminal',
    });
  });

  it.runIf(!TERMINAL_ENABLED)('redireciona a rota de terminal quando o recurso esta desligado', async () => {
    window.history.pushState({}, '', '/terminal/abc?title=Meu%20Terminal&cwd=%2Ftmp');
    render(<App />);

    expect(await screen.findByText(/, Ana/)).toBeInTheDocument();
    expect(screen.queryByText(/Terminal Mock/)).not.toBeInTheDocument();
    expect(openTabSpy).not.toHaveBeenCalled();
  });
});

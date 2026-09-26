import { createContext, lazy, Suspense, useState, useEffect, useRef, useCallback, useContext } from 'react';
import { BrowserRouter, Routes, Route, useParams, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Editor } from './components/Editor/Editor';
import { useTree } from './hooks/useTree';
import { useTabs } from './hooks/useTabs';
import type { Tab } from './hooks/useTabs';
import { api, invalidateLocalSession } from './api/client';
import { prepareBrowserSession } from './api/browserSession';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { SettingsPage } from './pages/SettingsPage';
import { RememberErrorBoundary } from './components/Remember/RememberErrorBoundary';
import { DashboardHome } from './components/Dashboard/DashboardHome';
import { NotesPage } from './pages/NotesPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { SharedPagesProvider } from './components/Shared/SharedPagesProvider';
import { Tabs } from './components/Tabs/Tabs';
import { InfiniteRenderer } from './components/Infinite/InfiniteRenderer';
import { TerminalDrawer, type TerminalRequest } from './components/Terminal/TerminalDrawer';
import type { Page } from './types';
import terminalIconUrl from './assets/icons/terminal.svg';
import notesIconUrl from './assets/icons/notes.svg';

function buildPagePath(id: string): string {
  return `/page/${id}`;
}

function buildRememberPath(): string {
  return '/remember';
}

function buildTerminalPath(request: TerminalRequest): string {
  const params = new URLSearchParams();
  params.set('title', request.title);
  if (request.cwd) params.set('cwd', request.cwd);
  return `/terminal/${encodeURIComponent(request.key)}?${params.toString()}`;
}

function createPageTab(page: { id: string; title: string; icon?: string | null }, separateTab = false): Tab {
  const tabId = separateTab ? page.id + ':' + Date.now() : page.id;
  return {
    id: tabId,
    title: page.title,
    icon: page.icon,
    path: separateTab ? buildPagePath(page.id) + '?tab=' + encodeURIComponent(tabId) : buildPagePath(page.id),
  };
}

function createTerminalTab(request: TerminalRequest): Tab {
  return {
    id: request.key,
    title: request.title,
    icon: TERMINAL_ICON_URL,
    path: buildTerminalPath(request),
  };
}

function createRememberTab(): Tab {
  return {
    id: 'remember',
    title: 'Memória',
    icon: REMEMBER_ICON_URL,
    path: buildRememberPath(),
  };
}

function createNotesTab(): Tab {
  return { id: 'notes', title: 'Notas', icon: '📝', path: '/notes' };
}

const TERMINAL_ICON_URL = terminalIconUrl;
const REMEMBER_ICON_URL = notesIconUrl;
const isTerminalEnabled = () => import.meta.env.VITE_TERMINAL_ENABLED === 'true';
const RememberPage = lazy(() => import('./pages/RememberPage').then((module) => ({ default: module.RememberPage })));

// ── Private Route ──────────────────────────────────────────────────────────

const AccountRoleContext = createContext<'owner' | 'member'>('member');

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [verified, setVerified] = useState<'loading' | 'yes' | 'no' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [role, setRole] = useState<'owner' | 'member'>('member');
  useEffect(() => {
    let active = true;
    api.getMe().then(user => {
      if (!active) return;
      prepareBrowserSession(user.id);
      setRole(user.role ?? 'owner');
      setVerified('yes');
    }).catch(error => {
      if (!active) return;
      if (/API 401|API 403/.test(String(error))) {
        invalidateLocalSession();
        setVerified('no');
      } else {
        setVerified('unavailable');
      }
    });
    return () => { active = false; };
  }, [attempt]);
  if (verified === 'loading') return <div role="status" aria-live="polite">Verificando sessão…</div>;
  if (verified === 'unavailable') return <div role="alert">Não foi possível verificar a sessão. <button type="button" onClick={() => { setVerified('loading'); setAttempt(value => value + 1); }}>Tentar novamente</button></div>;
  if (verified === 'no') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <AccountRoleContext.Provider value={role}>{children}</AccountRoleContext.Provider>;
}

// ── Page view ─────────────────────────────────────────────────────────────

interface PageViewProps {
  onRefresh?: () => void;
  onPageOpen?: () => void;
  tabs: Tab[];
  onOpenTab: (tab: Tab) => void;
  onPageNavigate: (page: { id: string; title: string; icon?: string | null }, openInNewTab?: boolean) => void;
}

function PageView({ onRefresh, onPageOpen, tabs, onOpenTab, onPageNavigate }: PageViewProps) {
  const { id } = useParams<{ id: string }>();
  const [pageState, setPageState] = useState<{
    page: Page | null;
    error: string | null;
    resolvedId: string | null;
  }>({
    page: null,
    error: null,
    resolvedId: null,
  });
  const tabsRef = useRef(tabs);
  const onPageOpenRef = useRef(onPageOpen);
  const onOpenTabRef = useRef(onOpenTab);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    onPageOpenRef.current = onPageOpen;
  }, [onPageOpen]);

  useEffect(() => {
    onOpenTabRef.current = onOpenTab;
  }, [onOpenTab]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .getPage(id)
      .then(p => {
        if (cancelled) return;
        setPageState({
          page: p,
          error: null,
          resolvedId: id,
        });
        onPageOpenRef.current?.();

        // Ensure page is in tabs
        const exists = tabsRef.current.some(t => t.path === buildPagePath(p.id) || t.path.startsWith(buildPagePath(p.id) + "?"));
        if (!exists) {
          onOpenTabRef.current(createPageTab(p));
        }
      })
      .catch(e => {
        if (cancelled) return;
        setPageState({
          page: null,
          error: String(e),
          resolvedId: id,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const loading = !!id && pageState.resolvedId !== id;
  const error = pageState.resolvedId === id ? pageState.error : null;
  const page = pageState.resolvedId === id ? pageState.page : null;

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Carregando…</div>;
  if (error) return <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>;
  if (!page) return null;

  if (page.type === 'infinite') {
    return (
      <InfiniteRenderer
        key={page.id}
        page={page}
      />
    );
  }

  return (
    <Editor
      key={page.id}
      page={page}
      onRefresh={onRefresh}
      onNavigatePage={onPageNavigate}
    />
  );
}

function TerminalPage({ tabs, onOpenTab }: { tabs: Tab[]; onOpenTab: (tab: Tab) => void }) {
  const role = useContext(AccountRoleContext);
  const { terminalKey } = useParams<{ terminalKey: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const request = terminalKey
    ? {
        key: decodeURIComponent(terminalKey),
        title: searchParams.get('title') || 'Terminal',
        cwd: searchParams.get('cwd'),
      }
    : null;

  useEffect(() => {
    if (!request || role !== 'owner') return;
    const exists = tabs.find((tab) => tab.id === request.key);
    if (!exists) onOpenTab(createTerminalTab(request));
  }, [onOpenTab, request?.key, role]);

  if (role !== 'owner') {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Terminal disponível apenas na conta do proprietário do PC.</div>;
  }

  if (!request) {
    return <div className="flex-1 flex items-center justify-center text-red-400 text-sm">Terminal inválido</div>;
  }

  return (
    <TerminalDrawer
      open
      request={request}
      onClose={() => navigate('/')}
      variant="page"
    />
  );
}

function RememberRoute({ tabs, onOpenTab }: { tabs: Tab[]; onOpenTab: (tab: Tab) => void }) {
  useEffect(() => {
    const exists = tabs.find((tab) => tab.id === 'remember');
    if (!exists) onOpenTab(createRememberTab());
  }, [onOpenTab]);

  // The memory panel reads/writes the `date` search param via the router, so no remount key is needed.
  return <RememberErrorBoundary><Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-gray-500">Carregando Memória…</div>}><RememberPage /></Suspense></RememberErrorBoundary>;
}

function NotesRoute({ tabs, onOpenTab }: { tabs: Tab[]; onOpenTab: (tab: Tab) => void }) {
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === 'notes')) onOpenTab(createNotesTab());
  }, [onOpenTab]);
  return <NotesPage />;
}


// ── Layout ────────────────────────────────────────────────────────────────

function Layout() {
  const { tree, loading, refresh } = useTree();
  const location = useLocation();
  const activePage = location.pathname.startsWith('/page/') ? decodeURIComponent(location.pathname.slice('/page/'.length)) : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { tabs, activeTabId, openTab, closeTab, closeAllTabs, setActiveTab, replaceActiveTab, newTab, goBack } = useTabs();

  // No desktop a sidebar fica sempre visível; no mobile inicia fechada
  const isMobile = useCallback(() => window.innerWidth < 768, []);

  // Fecha sidebar ao navegar para uma página (mobile)
  const handlePageOpen = useCallback(() => {
    if (isMobile()) setSidebarOpen(false);
  }, [isMobile]);

  // Fecha ao clicar fora (mobile)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!isMobile()) return;
      if (!sidebarOpen) return;
      const sidebar = document.getElementById('app-sidebar');
      const toggle = document.getElementById('sidebar-toggle');
      if (sidebar && !sidebar.contains(e.target as Node) && toggle && !toggle.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isMobile, sidebarOpen]);

  const handleOpenRememberDate = useCallback((date?: string) => {
    const tab = createRememberTab();
    if (date) tab.path = `${buildRememberPath()}?date=${encodeURIComponent(date)}`;
    replaceActiveTab(tab);
    handlePageOpen();
  }, [handlePageOpen, replaceActiveTab]);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleSidebarPageClick = useCallback((page: { id: string; title: string; icon?: string | null }, openInNewTab = false) => {
    const tab = createPageTab(page, openInNewTab);
    if (openInNewTab) openTab(tab);
    else replaceActiveTab(tab);
    handlePageOpen();
  }, [handlePageOpen, openTab, replaceActiveTab]);

  return (
    <div className="flex h-full overflow-hidden" style={{ height: 'var(--app-viewport-height, 100%)' }}>
      {/* Overlay escuro no mobile quando sidebar aberta */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — mobile: drawer, desktop: sempre visível */}
      <div
        id="app-sidebar"
        style={{ height: 'var(--app-viewport-height, 100%)' }}
        className={`
          fixed md:relative z-30 md:z-auto
          h-full
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {loading ? (
          <div className="w-56 h-full bg-[#111111] border-r border-[#1f1f1f] flex items-center justify-center">
            <span className="text-xs text-gray-600">Carregando…</span>
          </div>
        ) : (
          <Sidebar
            tree={tree}
            activePage={activePage ?? null}
            onRefresh={refresh}
            onClose={handleSidebarClose}
            onPageClick={handleSidebarPageClick}
            onRememberOpen={handleOpenRememberDate}
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTab}
            onTabClose={closeTab}
            onCloseAllTabs={closeAllTabs}
            onNewTab={newTab}
            onGoBack={goBack}
          />
        )}
      </div>

      <main className="flex-1 h-full overflow-hidden flex flex-col bg-[#191919] min-w-0">
        {/* Topbar mobile com botão de menu */}
        <div className="flex md:hidden items-center gap-3 px-3 py-3 border-b border-[#2a2a2a] bg-[#111111] shrink-0">
          <button
            id="sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#303030] bg-[#1b1b1b] text-gray-300 hover:text-white"
            aria-label="Abrir árvore de navegação"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          <button type="button" className="min-w-0 flex-1 text-left" aria-label="Brain Core: abrir Dashboard" onClick={() => { navigate('/'); setSidebarOpen(false); }}>
            <span className="block truncate text-sm font-semibold text-white">Brain Core</span>
          </button>
        </div>

        <div className="hidden md:block"><Tabs
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={setActiveTab}
          onTabClose={closeTab}
          onCloseAllTabs={closeAllTabs}
          onNewTab={newTab}
          onGoBack={goBack}
          onGoHome={() => navigate('/')}
        /></div>

        <Routes>
          <Route path="/" element={<DashboardHome onOpenPage={handleSidebarPageClick} />} />
          <Route path="/knowledge" element={<KnowledgePage tree={tree} onOpenPage={handleSidebarPageClick} onOpenTree={() => setSidebarOpen(true)} />} />
          <Route path="/notes" element={<NotesRoute tabs={tabs} onOpenTab={openTab} />} />
          <Route path="/remember" element={<RememberRoute tabs={tabs} onOpenTab={openTab} />} />
          <Route
            path="/page/:id"
            element={
              <PageView
                onRefresh={refresh}
                onPageOpen={handlePageOpen}
                tabs={tabs}
                onOpenTab={replaceActiveTab}
                onPageNavigate={handleSidebarPageClick}
              />
            }
          />
          <Route
            path="/terminal/:terminalKey"
            element={isTerminalEnabled() ? <TerminalPage tabs={tabs} onOpenTab={openTab} /> : <Navigate to="/" replace />}
          />
        </Routes>
      </main>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <SharedPagesProvider>
                <Layout />
              </SharedPagesProvider>
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useParams, Navigate, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Editor } from './components/Editor/Editor';
import { useTree } from './hooks/useTree';
import { normalizeTerminalTabTitle, useTabs } from './hooks/useTabs';
import type { Tab } from './hooks/useTabs';
import { api } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { SettingsPage } from './pages/SettingsPage';
import { RememberErrorBoundary } from './components/Remember/RememberErrorBoundary';
import { DashboardHome } from './components/Dashboard/DashboardHome';
import { Tabs } from './components/Tabs/Tabs';
import { InfiniteRenderer } from './components/Infinite/InfiniteRenderer';
import type { TerminalRequest } from './components/Terminal/TerminalDrawer';
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
  params.set('title', normalizeTerminalTabTitle(request.title));
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
    title: normalizeTerminalTabTitle(request.title),
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

const TERMINAL_ICON_URL = terminalIconUrl;
const REMEMBER_ICON_URL = notesIconUrl;
const TERMINAL_ENABLED = import.meta.env.VITE_TERMINAL_ENABLED === 'true';
const RememberPage = lazy(() => import('./pages/RememberPage').then((module) => ({ default: module.RememberPage })));
const TerminalDrawer = lazy(() => import('./components/Terminal/TerminalDrawer').then((module) => ({ default: module.TerminalDrawer })));

// ── Private Route ──────────────────────────────────────────────────────────

function PrivateRoute({ children }: { children: React.ReactNode }) {
  if (!api.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
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
  const { terminalKey } = useParams<{ terminalKey: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const request = terminalKey
    ? {
        key: decodeURIComponent(terminalKey),
        title: normalizeTerminalTabTitle(searchParams.get('title')),
        cwd: searchParams.get('cwd'),
      }
    : null;

  useEffect(() => {
    if (!request) return;
    const exists = tabs.find((tab) => tab.id === request.key);
    if (!exists) onOpenTab(createTerminalTab(request));
  }, [onOpenTab, request?.key]);

  if (!request) {
    return <div className="flex-1 flex items-center justify-center text-red-400 text-sm">Terminal inválido</div>;
  }

  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-gray-500">Carregando terminal…</div>}>
      <TerminalDrawer
        open
        request={request}
        onClose={() => navigate('/')}
        variant="page"
      />
    </Suspense>
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


// ── Layout ────────────────────────────────────────────────────────────────

function Layout() {
  const { tree, loading, refresh } = useTree();
  const location = useLocation();
  const activePage = location.pathname.startsWith('/page/') ? decodeURIComponent(location.pathname.slice('/page/'.length)) : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { tabs, activeTabId, openTab, closeTab, setActiveTab, replaceActiveTab, newTab, goBack } = useTabs();

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

  const handleOpenRememberDate = useCallback((date?: string, openInNewTab = false) => {
    const tab = createRememberTab();
    if (date) tab.path = `${buildRememberPath()}?date=${encodeURIComponent(date)}`;
    if (openInNewTab) openTab(tab);
    else replaceActiveTab(tab);
    handlePageOpen();
  }, [handlePageOpen, openTab, replaceActiveTab]);

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
    <div className="flex h-screen overflow-hidden">
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
          />
        )}
      </div>

      <main className="flex-1 h-full overflow-hidden flex flex-col bg-[#191919] min-w-0">
        {/* Topbar mobile com botão de menu */}
        <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-[#1f1f1f] bg-[#111111] shrink-0">
          <button
            id="sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
            aria-label="Abrir menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>
          <span className="text-[12px] text-gray-500 font-medium leading-none">Brain Core</span>
        </div>

        <Tabs
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={setActiveTab}
          onTabClose={closeTab}
          onNewTab={newTab}
          onGoBack={goBack}
          onGoHome={() => navigate('/')}
        />

        <Routes>
          <Route path="/" element={<DashboardHome onOpenPage={handleSidebarPageClick} />} />
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
            element={TERMINAL_ENABLED ? <TerminalPage tabs={tabs} onOpenTab={openTab} /> : <Navigate to="/" replace />}
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
              <Layout />
            </PrivateRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

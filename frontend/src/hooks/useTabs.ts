import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { closeTerminalSessionForRequestKey } from '../components/Terminal/terminalSessionRegistry';
import { api, type PersistedTerminalTab } from '../api/client';

export interface Tab {
  id: string;
  title: string;
  icon?: string | null;
  path: string;
  history?: string[];
  historyIndex?: number;
}

const STORAGE_KEY = 'brain-core-tabs';
import terminalIconUrl from '../assets/icons/terminal.svg';

const TERMINAL_ICON_URL = terminalIconUrl;

function shouldRestoreTerminalRoute(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 768;
}

function isTerminalPath(path: string): boolean {
  return path.startsWith('/terminal/');
}

function stripSearch(path: string): string {
  const idx = path.indexOf('?');
  return idx >= 0 ? path.slice(0, idx) : path;
}

function buildTerminalPath(tab: PersistedTerminalTab): string {
  const params = new URLSearchParams();
  params.set('title', tab.title);
  if (tab.cwd) params.set('cwd', tab.cwd);
  return `/terminal/${encodeURIComponent(tab.request_key)}?${params.toString()}`;
}

export function useTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const [restoredTerminalPath, setRestoredTerminalPath] = useState<string | null>(null);
  const [terminalTabsLoaded, setTerminalTabsLoaded] = useState(false);

  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved) as Array<Partial<Tab>>;
      const restored = parsed
        .filter((tab): tab is Partial<Tab> & { id: string; title: string } => typeof tab?.id === 'string' && typeof tab?.title === 'string')
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          icon: tab.icon ?? null,
          path: typeof tab.path === 'string' ? tab.path : `/page/${tab.id}`,
          history: Array.isArray(tab.history) ? tab.history.filter((path): path is string => typeof path === 'string') : undefined,
          historyIndex: typeof tab.historyIndex === 'number' ? tab.historyIndex : undefined,
        }))
        .filter((tab) => !isTerminalPath(tab.path));
      return restored.filter((tab, index) => restored.findIndex((entry) => entry.id === tab.id) === index);
    } catch {
      return [];
    }
  });

  const currentRoute = location.pathname + location.search;
  const activeTabIndex = tabs.findIndex((tab) => tab.path === currentRoute || stripSearch(tab.path) === location.pathname);
  const activeTabId = activeTabIndex >= 0 ? tabs[activeTabIndex].id : null;
  const lastActiveTabId = useRef<string | null>(null);

  useEffect(() => {
    if (activeTabId) lastActiveTabId.current = activeTabId;
  }, [activeTabId]);

  // Persist tabs to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.filter((tab) => !isTerminalPath(tab.path))));
  }, [tabs]);

  useEffect(() => {
    let cancelled = false;

    api
      .listTerminalTabs()
      .then(({ tabs: persistedTabs }) => {
        if (cancelled) return;

        const mappedTabs: Tab[] = persistedTabs.map((tab) => ({
          id: tab.request_key,
          title: tab.title,
          icon: TERMINAL_ICON_URL,
          path: buildTerminalPath(tab),
        }));

        setTabs((prev) => {
          const withoutTerminalTabs = prev.filter((tab) => !isTerminalPath(tab.path));
          return [...withoutTerminalTabs, ...mappedTabs];
        });

        const activeTerminalTab = persistedTabs.find((tab) => tab.is_active) ?? persistedTabs[0];
        setRestoredTerminalPath(activeTerminalTab ? buildTerminalPath(activeTerminalTab) : null);
        setTerminalTabsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setTerminalTabsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!terminalTabsLoaded) return;
    if (!restoredTerminalPath) return;
    if (location.pathname !== '/') return;
    if (!shouldRestoreTerminalRoute()) return;
    const targetTab = tabs.find((tab) => tab.path === restoredTerminalPath && isTerminalPath(tab.path));
    if (!targetTab) return;
    navigate(targetTab.path, { replace: true });
  }, [location.pathname, navigate, restoredTerminalPath, tabs, terminalTabsLoaded]);

  const openTab = useCallback((tab: Tab) => {
    setTabs(prev => {
      const exists = prev.find(t => t.id === tab.id);
      if (exists) return prev;
      return [...prev, { ...tab, history: tab.history ?? [tab.path], historyIndex: tab.historyIndex ?? 0 }];
    });
    navigate(tab.path);
  }, [navigate]);

  const replaceActiveTab = useCallback((tab: Tab) => {
    setTabs((prev) => {
      const currentIndex = prev.findIndex((entry) => entry.path === currentRoute);
      const previousIndex = currentIndex >= 0
        ? currentIndex
        : prev.findIndex((entry) => entry.id === lastActiveTabId.current);
      if (previousIndex < 0) return [...prev, tab];
      const alreadyOpenIndex = prev.findIndex((entry, index) => index !== previousIndex && entry.id === tab.id);
      if (alreadyOpenIndex >= 0) return prev.map((entry, index) => index === alreadyOpenIndex ? { ...entry, path: tab.path, title: tab.title, icon: tab.icon } : entry);
      const next = [...prev];
      const active = next[previousIndex];
      const history = active.history ?? [active.path];
      const currentHistoryIndex = active.historyIndex ?? history.length - 1;
      const existingIndex = history.lastIndexOf(tab.path);
      const historyIndex = existingIndex >= 0 ? existingIndex : currentHistoryIndex + 1;
      const nextHistory = existingIndex >= 0 ? history : [...history.slice(0, currentHistoryIndex + 1), tab.path];
      next[previousIndex] = { ...tab, history: nextHistory, historyIndex };
      return next;
    });
    if (currentRoute !== tab.path) navigate(tab.path);
  }, [currentRoute, navigate]);

  const closeTab = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const closingIndex = tabs.findIndex((tab) => tab.id === id);
    const closingTab = closingIndex >= 0 ? tabs[closingIndex] : null;
    if (!closingTab) return;

    const isClosingCurrentRoute = closingIndex === activeTabIndex || id === activeTabId;
    if (isClosingCurrentRoute) {
      const leftTab = tabs.slice(0, closingIndex).reverse().find((tab) => tab.id !== id);
      const fallbackRightTab = tabs.slice(closingIndex + 1).find((tab) => tab.id !== id);
      navigate(leftTab?.path ?? fallbackRightTab?.path ?? '/');
    }

    setTabs((prev) => prev.filter((tab) => tab.id !== id));

    if (closingTab.path.startsWith('/terminal/')) {
      closeTerminalSessionForRequestKey(closingTab.id);
    }
  }, [activeTabId, activeTabIndex, navigate, tabs]);

  const closeAllTabs = useCallback(() => {
    setRestoredTerminalPath(null);
    setTabs((prev) => {
      prev
        .filter((tab) => tab.path.startsWith('/terminal/'))
        .forEach((tab) => closeTerminalSessionForRequestKey(tab.id));
      return [];
    });
    navigate('/');
  }, [navigate]);

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    closeAllTabs,
    setActiveTab: (id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      navigate(tab?.path ?? '/');
    },
    replaceActiveTab,
    goBack: () => {
      const tab = tabs.find((entry) => entry.id === (activeTabId ?? lastActiveTabId.current));
      if (!tab) return;
      const history = tab.history ?? [tab.path];
      const historyIndex = tab.historyIndex ?? history.length - 1;
      if (historyIndex <= 0) return;
      const previousIndex = historyIndex - 1;
      const previousPath = history[previousIndex];
      setTabs((prev) => prev.map((entry) => entry.id === tab.id ? { ...entry, historyIndex: previousIndex } : entry));
      navigate(previousPath);
    },
    newTab: () => {
      const id = 'home:' + Date.now();
      openTab({ id, title: 'Início', icon: '🏠', path: '/?tab=' + encodeURIComponent(id) });
    },
  };
}

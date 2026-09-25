import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { closeTerminalSessionForRequestKey } from '../components/Terminal/terminalSessionRegistry';
import { api, type PersistedTerminalTab } from '../api/client';
import terminalIconUrl from '../assets/icons/terminal.svg';
import notesIconUrl from '../assets/icons/notes.svg';

export interface Tab {
  id: string;
  title: string;
  icon?: string | null;
  path: string;
  history?: string[];
  historyIndex?: number;
}

const STORAGE_KEY = 'brain-core-tabs';
const TERMINAL_ICON_URL = terminalIconUrl;
const LEGACY_ICON_REPLACEMENTS: Record<string, string> = {
  'https://img.icons8.com/?size=100&id=19292&format=png&color=000000': terminalIconUrl,
  'https://img.icons8.com/?size=100&id=55fqUsmHwQDN&format=png&color=000000': notesIconUrl,
};

function normalizePersistedIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return LEGACY_ICON_REPLACEMENTS[icon] ?? icon;
}
const TERMINAL_ENABLED = import.meta.env.VITE_TERMINAL_ENABLED === 'true';
const FALLBACK_TERMINAL_TITLE = 'Terminal';

/**
 * Terminal titles are persisted so a live workspace can be restored after a
 * refresh. Older builds could save fragments of encoded markup as the title;
 * never let that leak back into the tab strip.
 */
export function normalizeTerminalTabTitle(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_TERMINAL_TITLE;

  const title = value.replace(/\s+/g, ' ').trim();
  const looksLikeEncodedMarkup = /(?:%[0-9a-f]{2}|<\/?svg\b|\b(?:viewbox|width|height|fill|stroke|rx)\s*=)/i.test(title);
  if (!title || title.length > 80 || looksLikeEncodedMarkup) return FALLBACK_TERMINAL_TITLE;

  return title;
}

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
  params.set('title', normalizeTerminalTabTitle(tab.title));
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
      return parsed
        .filter((tab): tab is Partial<Tab> & { id: string; title: string } => typeof tab?.id === 'string' && typeof tab?.title === 'string')
        .map((tab) => ({
          id: tab.id,
          title: isTerminalPath(typeof tab.path === 'string' ? tab.path : '')
            ? normalizeTerminalTabTitle(tab.title)
            : tab.title.trim(),
          icon: normalizePersistedIcon(tab.icon),
          path: typeof tab.path === 'string' ? tab.path : `/page/${tab.id}`,
          history: Array.isArray(tab.history) ? tab.history.filter((path): path is string => typeof path === 'string') : undefined,
          historyIndex: typeof tab.historyIndex === 'number' ? tab.historyIndex : undefined,
        }))
        .filter((tab) => !isTerminalPath(tab.path));
    } catch {
      return [];
    }
  });

  const currentRoute = location.pathname + location.search;
  // Exact match first; fall back to pathname-only match for routes that carry
  // extra query params (e.g. /page/x?ref=y). The fallback is skipped at the root
  // path, where several tabs share pathname "/" and are told apart only by their
  // ?tab= query — otherwise every home tab would resolve to the first one.
  const exactTabIndex = tabs.findIndex((tab) => tab.path === currentRoute);
  const activeTabIndex = exactTabIndex >= 0
    ? exactTabIndex
    : location.pathname === '/'
      ? -1
      : tabs.findIndex((tab) => stripSearch(tab.path) === location.pathname);
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
    if (!TERMINAL_ENABLED) {
      setTerminalTabsLoaded(true);
      return;
    }

    let cancelled = false;

    api
      .listTerminalTabs()
      .then(({ tabs: persistedTabs }) => {
        if (cancelled) return;

        const mappedTabs: Tab[] = persistedTabs.map((tab) => ({
          id: tab.request_key,
          title: normalizeTerminalTabTitle(tab.title),
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

    const isClosingCurrentRoute =
      closingIndex === activeTabIndex ||
      id === activeTabId ||
      closingTab.path === currentRoute ||
      (location.pathname !== '/' && stripSearch(closingTab.path) === location.pathname);
    if (isClosingCurrentRoute) {
      const leftTab = closingIndex > 0 ? tabs[closingIndex - 1] : null;
      const fallbackRightTab = closingIndex < tabs.length - 1 ? tabs[closingIndex + 1] : null;
      navigate(leftTab?.path ?? fallbackRightTab?.path ?? '/');
    }

    setTabs((prev) => prev.filter((tab) => tab.id !== id));

    if (closingTab.path.startsWith('/terminal/')) {
      closeTerminalSessionForRequestKey(closingTab.id);
    }
  }, [activeTabId, activeTabIndex, currentRoute, location.pathname, navigate, tabs]);

  const closeAllTabs = useCallback(() => {
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
      // Keep `path` pointing at where the tab actually is now, so route-based
      // active-tab resolution (and closeTab) still recognise this tab.
      setTabs((prev) => prev.map((entry) => entry.id === tab.id ? { ...entry, historyIndex: previousIndex, path: previousPath } : entry));
      navigate(previousPath);
    },
    newTab: () => {
      const id = 'home:' + Date.now();
      openTab({ id, title: 'Início', icon: '🏠', path: '/?tab=' + encodeURIComponent(id) });
    },
  };
}

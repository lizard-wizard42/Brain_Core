import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { isThemeChoice, resolvedTheme, THEME_STORAGE_KEY, type ThemeChoice } from './themes';

interface ThemeContextValue {
  choice: ThemeChoice;
  chooseTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(stored)) return stored;
  } catch { /* Storage may be disabled. */ }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(initialChoice);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);

  const chooseTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Keep the current session themed. */ }
    if (navigator.userAgent.includes('BrainCoreAndroid/1')) {
      window.location.href = `braincore://theme/${next}`;
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setChoice(isThemeChoice(event.newValue) ? event.newValue : 'system');
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme(choice, systemDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--theme-background').trim());
  }, [choice, systemDark]);

  return <ThemeContext.Provider value={{ choice, chooseTheme }}>{children}</ThemeContext.Provider>;
}

// The provider and its hook share one context by design.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme requires ThemeProvider');
  return context;
}

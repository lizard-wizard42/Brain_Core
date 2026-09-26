import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { resolvedTheme, THEME_STORAGE_KEY, themeChoices, themes } from './themes';

function Picker() {
  const { choice, chooseTheme } = useTheme();
  return <button onClick={() => chooseTheme('cloud-white')}>{choice}</button>;
}

function AllChoices() {
  const { choice, chooseTheme } = useTheme();
  return <div>{themeChoices.map(id => <button key={id} aria-pressed={choice === id} onClick={() => chooseTheme(id)}>{id}</button>)}</div>;
}

describe('appearance preferences', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('defines the six requested custom palettes', () => {
    expect(Object.keys(themes).filter(id => !['dark', 'light'].includes(id))).toHaveLength(6);
    expect(themes['deep-sea'].background).toBe('#0A192F');
    expect(themes['cyber-sunset'].primary).toBe('#FF0080');
    expect(themes['minty-fresh'].accent).toBe('#60EFFF');
    expect(themes['cloud-white'].text).toBe('#1E293B');
    expect(themes['neon-skyline'].accent2).toBe('#4299E1');
    expect(themes['y2k-arcade'].accent2).toBe('#DD6B20');
  });

  it('follows the operating system when selected', () => {
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
  });

  it('persists a selection across mounts', () => {
    const first = render(<ThemeProvider><Picker /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('cloud-white');
    first.unmount();
    render(<ThemeProvider><Picker /></ThemeProvider>);
    expect(screen.getByRole('button', { name: 'cloud-white' })).toBeInTheDocument();
  });

  it('applies every palette through repeated changes and persists the final choice', () => {
    render(<ThemeProvider><AllChoices /></ThemeProvider>);
    for (const id of [...themeChoices, ...themeChoices].filter(id => id !== 'system')) {
      fireEvent.click(screen.getByRole('button', { name: id }));
      expect(document.documentElement.dataset.theme).toBe(id);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(id);
    }
  });

  it('updates with system changes and returns to system when storage is cleared', () => {
    let dark = false;
    let notify: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return dark; },
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { notify = listener; },
      removeEventListener: vi.fn(),
    })));
    render(<ThemeProvider><AllChoices /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe('light');
    dark = true;
    act(() => notify?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'cloud-white' }));
    dark = false;
    act(() => notify?.({ matches: false } as MediaQueryListEvent));
    expect(document.documentElement.dataset.theme).toBe('cloud-white');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null })));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'deep-sea' }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('does not replace the web preference with a stale Android URL theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'cloud-white');
    window.history.replaceState({}, '', '/?theme=dark');
    try {
      render(<ThemeProvider><Picker /></ThemeProvider>);
      expect(screen.getByRole('button', { name: 'cloud-white' })).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});

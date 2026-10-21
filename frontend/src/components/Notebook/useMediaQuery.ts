import { useSyncExternalStore } from 'react';

/** Live CSS media query; false where matchMedia is unavailable (tests, very old WebViews). */
export function useMediaQuery(query: string): boolean {
  const subscribe = (notify: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const list = window.matchMedia(query);
    list.addEventListener?.('change', notify);
    return () => list.removeEventListener?.('change', notify);
  };
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches, () => false);
}

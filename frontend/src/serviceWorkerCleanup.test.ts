import { describe, expect, it, vi } from 'vitest';
import {
  isBrainLegacyCache,
  isBrainLegacyRegistration,
  legacyServiceWorkerIdentity,
} from './serviceWorkerCleanup';

function registration(scope: string, scriptURL: string): ServiceWorkerRegistration {
  return {
    scope,
    active: { scriptURL },
    waiting: null,
    installing: null,
    unregister: vi.fn(),
  } as unknown as ServiceWorkerRegistration;
}

describe('legacy Brain Core storage ownership', () => {
  it.each([
    ['/', 'https://example.test/', 'https://example.test/sw.js'],
    ['/brain/', 'https://example.test/brain/', 'https://example.test/brain/sw.js'],
  ])('resolves base %s to exact scope and worker', (base, scope, scriptUrl) => {
    expect(legacyServiceWorkerIdentity('https://example.test', base)).toEqual({ scope, scriptUrl });
  });

  it('matches only the worker with the exact Brain scope and script', () => {
    const identity = legacyServiceWorkerIdentity('https://example.test', '/brain/');
    expect(isBrainLegacyRegistration(registration(identity.scope, identity.scriptUrl), identity)).toBe(true);
    expect(isBrainLegacyRegistration(registration('https://example.test/other/', identity.scriptUrl), identity)).toBe(false);
    expect(isBrainLegacyRegistration(registration(identity.scope, 'https://example.test/other-sw.js'), identity)).toBe(false);
    const mixed = registration(identity.scope, identity.scriptUrl);
    (mixed as unknown as { waiting: ServiceWorker }).waiting = {
      scriptURL: 'https://example.test/brain/new-sw.js',
    } as ServiceWorker;
    expect(isBrainLegacyRegistration(mixed, identity)).toBe(false);
  });

  it('preserves caches belonging to other apps and Workbox scopes', () => {
    const scope = 'https://example.test/brain/';
    expect(isBrainLegacyCache(`workbox-precache-v2-${scope}`, scope)).toBe(true);
    expect(isBrainLegacyCache('api-cache', scope)).toBe(false);
    expect(isBrainLegacyCache('api-cache', scope, true)).toBe(true);
    expect(isBrainLegacyCache('brain-core-future', scope)).toBe(true);
    expect(isBrainLegacyCache('other-cache', scope)).toBe(false);
    expect(isBrainLegacyCache('workbox-precache-v2-https://example.test/other/', scope)).toBe(false);
  });
});

export interface LegacyServiceWorkerIdentity {
  scope: string;
  scriptUrl: string;
}

export function legacyServiceWorkerIdentity(origin: string, baseUrl: string): LegacyServiceWorkerIdentity {
  const scope = new URL(baseUrl, origin).href;
  return { scope, scriptUrl: new URL('sw.js', scope).href };
}

export function isBrainLegacyRegistration(
  registration: ServiceWorkerRegistration,
  identity: LegacyServiceWorkerIdentity,
): boolean {
  if (registration.scope !== identity.scope) return false;
  const workers = [registration.active, registration.waiting, registration.installing]
    .filter((worker): worker is ServiceWorker => worker !== null);
  return workers.length > 0 && workers.every((worker) => worker.scriptURL === identity.scriptUrl);
}

export function isBrainLegacyCache(cacheName: string, scope: string, includeGenericLegacy = false): boolean {
  return cacheName === `workbox-precache-v2-${scope}`
    || cacheName === `workbox-runtime-${scope}`
    || (includeGenericLegacy && (cacheName === 'api-cache' || cacheName === 'pdf-bypass'))
    || cacheName.startsWith('brain-core-');
}

export async function cleanupBrainLegacyStorage(origin: string, baseUrl: string): Promise<void> {
  const identity = legacyServiceWorkerIdentity(origin, baseUrl);
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const legacyRegistrations = registrations
      .filter((registration) => isBrainLegacyRegistration(registration, identity));
    await Promise.all(
      legacyRegistrations.map((registration) => registration.unregister()),
    );
    const includeGenericLegacy = legacyRegistrations.length > 0;
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => isBrainLegacyCache(key, identity.scope, includeGenericLegacy))
          .map((key) => caches.delete(key)),
      );
    }
    return;
  }
  if ('caches' in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => isBrainLegacyCache(key, identity.scope, false))
        .map((key) => caches.delete(key)),
    );
  }
}

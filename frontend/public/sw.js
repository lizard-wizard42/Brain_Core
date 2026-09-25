// Transitional worker: removes the legacy PWA cache from existing clients.
// The app no longer registers a service worker, so this file is only fetched
// by browsers that still have the old registration.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
    const keys = await caches.keys();
    const scope = self.registration.scope;
    const ownedCaches = new Set([
      `workbox-precache-v2-${scope}`,
      `workbox-runtime-${scope}`,
      'api-cache',
      'pdf-bypass',
    ]);
    await Promise.all(keys
      .filter((key) => ownedCaches.has(key) || key.startsWith('brain-core-'))
      .map((key) => caches.delete(key)));
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});

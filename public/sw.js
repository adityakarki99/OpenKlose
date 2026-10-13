// The hosted canvas's service worker: once the page has loaded over the
// network, it opens again without one, like excalidraw.com does. Registered
// only by the hosted build (see index.tsx); the canvas a `klose serve`
// process serves never installs it.
//
// Network first, so a new deploy is picked up on the next load; the cache
// only answers when the network can't. Same-origin GETs only, and the live
// preview's sandbox has an opaque origin that no service worker controls, so
// previews still need their bundle from the HTTP cache or the network.
const CACHE = 'klose-hosted-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (err) {
        const hit = await cache.match(request);
        if (hit) return hit;
        // A deep link into the app while offline: serve the shell.
        if (request.mode === 'navigate') {
          const shell = await cache.match(new URL(self.registration.scope).pathname);
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});

/* RetailMind service worker. The build (scripts/sw-plugin.js) rewrites the VERSION and PRECACHE
   lines below with the exact files of that build, so a new deploy always means a new cache.

   - app shell + every hashed asset are precached, so repeat visits open instantly and offline
   - hashed assets are cache-first (their names change whenever their content does)
   - the other listed files are stale-while-revalidate; nothing else is touched
   The data lives in IndexedDB and the API runs in-page, so nothing here touches user data. */
const VERSION = "dev";
const CACHE = `rm-${VERSION}`;
const PRECACHE = [];
const SCOPE = new URL(self.registration.scope);
// The paths this worker is allowed to answer: the files listed above. Anything else (an API served from the same
// origin, in the server edition) is never cached here and always goes to the network.
const STATIC_PATHS = new Set(PRECACHE.map((url) => new URL(url, SCOPE).pathname));
// Hosts (and Vite's own preview server) often send `Vary: Origin`. Module-script requests carry an Origin
// header and the copies stored at install time do not, so a strict match misses and an offline `import()`
// fails even though the file is sitting in the cache. Nothing here varies by request header.
const MATCH = { ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((url) => new Request(new URL(url, SCOPE), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("rm-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(fallbackKey ?? request, MATCH);
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(fallbackKey ?? request, response.clone());
    return response;
  });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;

  // Single-page app: every navigation gets the cached shell (routes live in the URL hash). The shell is
  // stored under the scope root, which is what was precached at install, so it works offline straight away.
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(new Request(SCOPE.href), SCOPE.href));
    return;
  }
  if (url.pathname.startsWith(`${SCOPE.pathname}assets/`)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (STATIC_PATHS.has(url.pathname)) event.respondWith(staleWhileRevalidate(request));
});

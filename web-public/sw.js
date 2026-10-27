// Service worker for the hosted app: makes it work offline once installed.
//
// On install it caches every file of the app. After that, every request is
// answered from the cache first, so the app opens with no connection. When
// online, it quietly fetches a fresh copy in the background; a new version
// is used the next time the app is opened.
//
// The build id and the list of files to cache are filled in by scripts/postbuild.mjs.

const CACHE = "g3mb-__BUILD_ID__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("g3mb-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle this app's own files.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === "navigate" ? "./index.html" : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") cache.put(key, res.clone());
          return res;
        })
        .catch(() => undefined);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const fresh = await refresh;
      return fresh ?? new Response("Offline and not cached yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }),
  );
});

/**
 * Times Tables Challenge and Dozen Galaxy: service worker
 * Enables "Add to Home Screen" installability and basic offline play.
 * Bump CACHE_NAME whenever you change the app (use a date stamp) so old caches get cleared.
 *
 * SHARED ORIGIN: other apps on this site keep their own caches on the same origin. So this worker must ONLY ever
 * touch caches whose name starts with CACHE_PREFIX, and only ever look in its own cache. (Deleting "every cache
 * that is not mine" wipes the other apps' offline files.)
 *
 * ONE COPY PER PAGE: the query string (?v=, ?profile=, ?host=) is not part of what is stored. A page opened online
 * replaces the one stored copy of that page, so every address of it opens the newest copy when offline.
 */
const CACHE_PREFIX = "ttc-cache-";
const CACHE_NAME = CACHE_PREFIX + "20261101a";

const PRECACHE_URLS = [
  "./Multiplication.html",
  "./dozen-galaxy.html",          // the same game, published a second time as its own app (Dozen Galaxy)
  "./dozen-galaxy.webmanifest",
  "./dozen-icon-192.png",
  "./dozen-icon-512.png",
  "./dozen-apple-touch-icon.png",
  "./dozen-favicon-32.png",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache each file individually so one missing file doesn't block the rest; "reload" skips the browser's own copy, so a new worker never stores an old page
      return Promise.all(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // delete only OLD copies of THIS app's cache (same prefix); never another app's cache
      Promise.all(keys.filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const OWN_PATHS = PRECACHE_URLS.map((u) => new URL(u, self.location.href).pathname);

/* where a file is stored and looked up: its address without the query string */
function storeKey(url) { return url.origin + url.pathname; }

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only this app's own files: another app beside this one must never be answered from here.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || OWN_PATHS.indexOf(url.pathname) < 0) return;
  const key = storeKey(url);

  // HTML pages: try the network first (so kids get the latest quiz logic
  // when online), fall back to cache if offline.
  if (req.mode === "navigate" || req.destination === "document") {
    const isDozen = /dozen-galaxy/i.test(url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {                                   // never cache a 404 page
            // the two page names are byte-identical copies of one game, so a fresh copy of either is the fresh copy of both
            const copy = res.clone(), twin = res.clone(), twinKey = storeKey(new URL(isDozen ? "./Multiplication.html" : "./dozen-galaxy.html", self.location.href));
            caches.open(CACHE_NAME).then((cache) => { cache.put(key, copy); cache.put(twinKey, twin); });
          }
          return res;
        })
        // offline: the page's one stored copy; failing that the other name of the same game (the page itself decides by its address which app it is)
        .catch(() => caches.open(CACHE_NAME).then((c) => c.match(key).then((r) => r || c.match(isDozen ? "./Multiplication.html" : "./dozen-galaxy.html"))))
    );
    return;
  }

  // Everything else (icons, manifest, etc): cache-first, then network.
  event.respondWith(
    caches.open(CACHE_NAME).then((c) => c.match(key)).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(key, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

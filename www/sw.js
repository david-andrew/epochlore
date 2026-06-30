/* Network-first service worker.
 * Tries the network first (so an online user always gets the freshest deployed app and the
 * cache is kept up to date), and falls back to the cached app shell when offline. Live data
 * endpoints (/timeline, /mtime, /file/) are never cached. */
const CACHE = "epochlore-v2";
const SHELL = [
  "./", "./index.html", "./download.html", "./app.js", "./storage.js", "./styles.css",
  "./vendor/marked.min.js", "./vendor/purify.min.js",
  "./manifest.webmanifest", "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/timeline" || url.pathname === "/mtime" || url.pathname.startsWith("/file/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});

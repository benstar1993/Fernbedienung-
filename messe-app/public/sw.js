/* Offline-Cache: App-Dateien vorab, Plan-Kacheln und Booklet-Bilder beim ersten Abruf. */
const VERSION = "mt-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "store.js", "scanner.js", "vendor/leaflet.js", "vendor/leaflet.css", "vendor/zxing.min.js",
  "data/project.json", "data/plan_legend.jpg", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  const isAsset = url.pathname.includes("/data/tiles/") || url.pathname.includes("/data/booklet/");
  if (isAsset) {
    // Bilder ändern sich nicht → Cache zuerst
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  } else {
    // App & Daten → Netz zuerst, offline aus dem Cache
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const cl = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cl)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});

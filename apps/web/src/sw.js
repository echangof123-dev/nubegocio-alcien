// Service worker de Al Cien: la app abre aunque la señal esté mala.
// Nunca guarda respuestas de /api (datos de dinero siempre frescos).
const VERSION = "__VERSION__";
const CACHE = "alcien-" + VERSION;
const PRECARGA = __PRECARGA__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("alcien-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Pantallas: primero la red, si no hay señal la copia guardada
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
    return;
  }
  // Archivos con hash: primero la copia guardada
  e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request)));
});

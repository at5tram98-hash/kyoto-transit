const VERSION = "__BUILD_VERSION__";
const CACHE = `mymap-static-${VERSION}`;
const PRECACHE = __PRECACHE__;
const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  // A failed asset prevents activation; open journeys keep their current build.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scoped))),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Keep preceding builds while other windows may still be using them.
      if (clients.length <= 1) {
        const keys = (await caches.keys()).filter(
          (k) => k.startsWith("mymap-static-") && k !== CACHE,
        );
        await Promise.all(keys.slice(0, -1).map((k) => caches.delete(k)));
      }
      await self.clients.claim();
    })(),
  );
});
async function navigation(request, event) {
  const cache = await caches.open(CACHE),
    shell = await cache.match(scoped("index.html"));
  try {
    const response = await fetch(request),
      html = await response.clone().text(),
      version = html.match(/js\/vnext\.js\?v=([a-f0-9]+)/)?.[1];
    if (shell && (!response.ok || (version && version !== VERSION))) {
      event.waitUntil(self.registration.update().catch(() => {}));
      return shell;
    }
    return response;
  } catch {
    return shell || Response.error();
  }
}
async function staticAsset(request) {
  const version = new URL(request.url).searchParams.get("v"),
    target = version ? `mymap-static-${version}` : CACHE;
  // Never serve another release's module as an offline fallback.
  if (await caches.has(target)) {
    const cache = await caches.open(target),
      cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
  }
  if (version && version !== VERSION) return Response.error();
  return fetch(request);
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL(self.registration.scope).pathname)
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request, event));
    return;
  }
  if (/\.(?:js|css|json|svg|webmanifest)$/.test(url.pathname))
    event.respondWith(staticAsset(request));
});

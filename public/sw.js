const VERSION = "__BUILD_VERSION__";
const CACHE = `mymap-static-${VERSION}`;
const PRECACHE = __PRECACHE__;
const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  // A failed asset prevents activation; open journeys keep their current build.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          PRECACHE.map((path) => {
            const url = new URL(scoped(path));
            if (url.pathname.endsWith(".js"))
              url.searchParams.set("v", VERSION);
            return new Request(url.href, { cache: "reload" });
          }),
        ),
      )
      .then(() => {
        // The previously published app registered sw.js?v=... and has no
        // update button. Migrate that registration once; subsequent releases
        // use the stable URL and wait for the user's saved-journey update.
        const previous = self.registration.active;
        if (previous && new URL(previous.scriptURL).searchParams.has("v"))
          return self.skipWaiting();
      }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
  if (event.data?.type === "GET_VERSION")
    event.ports[0]?.postMessage({ version: VERSION });
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
async function navigation(request) {
  const cache = await caches.open(CACHE),
    shell = await cache.match(scoped("index.html"));
  // Serve the complete installed release immediately. Updating the worker
  // builds the next complete shell without delaying navigation on a failed
  // connection or mixing the new HTML with the active release's modules.
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
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
  if (version && version !== VERSION)
    return new Response("This app version is unavailable", {
      status: 410,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
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
    event.respondWith(navigation(request));
    return;
  }
  if (/\.(?:js|css|json|svg|webmanifest)$/.test(url.pathname))
    event.respondWith(staticAsset(request));
});

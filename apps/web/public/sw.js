importScripts("/sw-policy.js");

const CACHE_PREFIX = "capture-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const STATIC_ASSETS = ["/capture-logo.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_CAPTURE_SHELL") return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const kind = self.CaptureOfflinePolicy.classifyRequest({
    method: request.method,
    mode: request.mode,
    origin: url.origin,
    appOrigin: self.location.origin,
    pathname: url.pathname,
  });

  if (kind === "static") {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  if (kind === "navigation") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (
            response.ok &&
            !response.redirected &&
            new URL(response.url).pathname === "/"
          ) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("/", response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/");
          return (
            cached ??
            new Response("Capture is offline. Reconnect once to prepare the app.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
  }
});

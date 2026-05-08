const SW_VERSION = "studio-pwa-v1";
const PAGE_CACHE = `${SW_VERSION}:pages`;
const ASSET_CACHE = `${SW_VERSION}:assets`;

const NETWORK_ONLY_SEGMENTS = ["/auth", "/checkout", "/me/", "/member-zone/"];
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(SW_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isBypassedPath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/auth/callback")
  );
}

function isNetworkOnlyPath(pathname) {
  return NETWORK_ONLY_SEGMENTS.some((segment) => pathname.includes(segment));
}

function isCacheableHtmlPath(pathname) {
  if (!pathname) return false;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 1) return true;
  if (segments.length === 2 && segments[1] === "classes") return true;
  if (segments.length === 3 && ["events", "services", "packages", "memberships"].includes(segments[1])) {
    return true;
  }
  return false;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return Response.error();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    void cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  if (isBypassedPath(url.pathname)) return;

  if (request.mode === "navigate") {
    if (isNetworkOnlyPath(url.pathname)) {
      return;
    }

    if (isCacheableHtmlPath(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request, PAGE_CACHE));
      return;
    }

    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }

  if (request.destination === "style" || request.destination === "script" || request.destination === "worker") {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  if (request.destination === "image" || request.destination === "font") {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

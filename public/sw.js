const SW_VERSION = "studio-pwa-v3";
const PAGE_CACHE = `${SW_VERSION}:pages`;
const ASSET_CACHE = `${SW_VERSION}:assets`;
const OFFLINE_URL = "/offline.html";

const NETWORK_ONLY_SEGMENTS = ["/auth", "/checkout", "/me/", "/member-zone/"];
const REMOTE_IMAGE_HOSTS = new Set(["image.mux.com", "i.ytimg.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
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

function isTrustedRemoteImage(url) {
  if (url.protocol !== "https:") return false;
  if (REMOTE_IMAGE_HOSTS.has(url.hostname)) return true;
  return url.pathname.includes("/storage/v1/object/public/");
}

function isCacheableResponse(response) {
  return Boolean(response) && (response.ok || response.type === "opaque");
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
  // /angle
  if (segments.length === 1) return true;
  // /angle/classes
  if (segments.length === 2 && segments[1] === "classes") return true;
  // /angle/classes/yoga, /angle/events/slug, /angle/services/slug, etc.
  if (
    segments.length === 3 &&
    ["classes", "events", "services", "packages", "memberships"].includes(segments[1])
  ) {
    return true;
  }
  return false;
}

async function offlineFallback() {
  const cache = await caches.open(PAGE_CACHE);
  return (await cache.match(OFFLINE_URL)) ?? Response.error();
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
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

  return offlineFallback();
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? offlineFallback();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function warmupImages(urls) {
  const cache = await caches.open(ASSET_CACHE);

  await Promise.all(
    urls.map(async (rawUrl) => {
      try {
        const url = new URL(rawUrl, self.location.origin);
        if (!isSameOrigin(url) && !isTrustedRemoteImage(url)) return;

        const request = new Request(url.toString(), {
          mode: isSameOrigin(url) ? "same-origin" : "no-cors",
          credentials: "omit",
        });

        const existing = await cache.match(request);
        if (existing) return;

        const response = await fetch(request);
        if (isCacheableResponse(response)) {
          await cache.put(request, response.clone());
        }
      } catch {
        // Ignore per-image warmup failures.
      }
    }),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "PREFETCH_URLS" || !Array.isArray(data.urls)) return;
  event.waitUntil?.(warmupImages(data.urls));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.destination === "image" && (isSameOrigin(url) || isTrustedRemoteImage(url))) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

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

  if (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker"
  ) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }
  if (request.destination === "font") {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

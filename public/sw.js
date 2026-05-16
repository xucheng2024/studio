const SW_VERSION = "studio-pwa-v9";
const PAGE_CACHE = `${SW_VERSION}:pages`;
const ASSET_CACHE = `${SW_VERSION}:assets`;
const OFFLINE_URL = "/offline.html";
const ONLINE_REQUIRED_URL = "/offline-online-required.html";

const NETWORK_ONLY_SEGMENTS = ["/auth", "/checkout", "/me/", "/member-zone/"];
const REMOTE_IMAGE_HOSTS = new Set(["image.mux.com", "i.ytimg.com", "i.vimeocdn.com"]);

self.addEventListener("install", (event) => {
  // Cache offline page but do NOT skipWaiting — let the user choose to refresh
  // via the update banner to avoid clearing caches while old tabs are still open.
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.addAll([OFFLINE_URL, ONLINE_REQUIRED_URL])),
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
  return NETWORK_ONLY_SEGMENTS.some((seg) => {
    const clean = seg.replace(/^\//, "").replace(/\/$/, "");
    return (
      pathname === `/${clean}` ||
      pathname.startsWith(`/${clean}/`) ||
      pathname.includes(`/${clean}/`)
    );
  });
}

/** Pull-to-refresh, address-bar Reload, etc. use cache mode `reload` so we must not serve stale HTML first. */
function isReloadNavigation(request) {
  return request.cache === "reload";
}

async function networkNavigateThenCache(request, cacheName) {
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

function isCacheableHtmlPath(pathname) {
  if (!pathname) return false;
  const segments = pathname.split("/").filter(Boolean);
  // /angle
  if (segments.length === 1) return true;
  // /angle/classes
  if (segments.length === 2 && segments[1] === "classes") return true;
  // /angle/classes, /angle/events, /angle/services, /angle/packages, /angle/member-zone, /angle/shop
  if (
    segments.length === 2 &&
    ["events", "services", "packages", "member-zone", "shop"].includes(segments[1])
  ) {
    return true;
  }
  // /angle/classes/yoga, /angle/events/slug, /angle/services/slug, /angle/shop/product, etc.
  if (
    segments.length === 3 &&
    ["classes", "events", "services", "packages", "memberships", "shop"].includes(segments[1])
  ) {
    return true;
  }
  return false;
}

async function offlineFallback() {
  const cache = await caches.open(PAGE_CACHE);
  return (await cache.match(OFFLINE_URL)) ?? Response.error();
}

async function onlineRequiredFallback() {
  const cache = await caches.open(PAGE_CACHE);
  return (await cache.match(ONLINE_REQUIRED_URL)) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
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

async function warmupPages(urls) {
  const cache = await caches.open(PAGE_CACHE);

  await Promise.all(
    urls.map(async (rawUrl) => {
      try {
        const url = new URL(rawUrl, self.location.origin);
        if (!isSameOrigin(url) || !isCacheableHtmlPath(url.pathname)) return;

        const request = new Request(url.toString(), {
          credentials: "same-origin",
        });
        const response = await fetch(request);
        if (isCacheableResponse(response)) {
          await cache.put(request, response.clone());
        }
      } catch {
        // Ignore per-page warmup failures.
      }
    }),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "PREFETCH_URLS" && Array.isArray(data.urls)) {
    event.waitUntil?.(warmupImages(data.urls));
    return;
  }
  if (data.type === "PREFETCH_PAGES" && Array.isArray(data.urls)) {
    event.waitUntil?.(warmupPages(data.urls));
    return;
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {};
  const title = payload.title ?? "Studio update";
  const options = {
    body: payload.body ?? "There is new content available.",
    icon: payload.icon ?? "/icons/icon.svg",
    badge: payload.badge ?? "/icons/icon.svg",
    tag: payload.tag ?? "studio-update",
    data: {
      url: payload.url ?? "/",
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => "focus" in client);
      if (existing) {
        existing.navigate?.(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
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
      event.respondWith(
        fetch(request).catch(async () => {
          return onlineRequiredFallback();
        }),
      );
      return;
    }

    if (isReloadNavigation(request)) {
      event.respondWith(networkNavigateThenCache(request, PAGE_CACHE));
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

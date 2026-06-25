"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function StudioPushOptIn({ studioSlug }: { studioSlug: string }) {
  const [showPanel, setShowPanel] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !studioSlug) return;
    setPermission(Notification.permission);

    void loadPushState(studioSlug)
      .catch(() => null);
  }, [studioSlug]);

  useEffect(() => {
    const handleOpen = () => setShowPanel(true);
    window.addEventListener("studio:notifications:open", handleOpen);
    return () => window.removeEventListener("studio:notifications:open", handleOpen);
  }, []);

  function getPathPrefix(slug: string) {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    const studioRoot = `/${slug}`;
    return pathname === studioRoot || pathname.startsWith(`${studioRoot}/`) ? studioRoot : "";
  }

  async function loadPushState(slug: string) {
    const [keyResponse, registration] = await Promise.all([
      fetch("/api/pwa/public-key"),
      navigator.serviceWorker.ready,
    ]);
    const keyJson = await keyResponse.json().catch(() => null);
    const key = String(keyJson?.publicKey ?? "");
    if (key) {
      setPublicKey(key);
    }

    if (Notification.permission !== "granted") {
      setIsEnabled(false);
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setIsEnabled(false);
      return;
    }

    const statusResponse = await fetch("/api/pwa/subscription-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studioSlug: slug,
        endpoint: subscription.endpoint,
      }),
    });
    const statusJson = await statusResponse.json().catch(() => null);
    setIsEnabled(Boolean(statusJson?.subscribed));
  }

  async function subscribe(slug: string, key: string) {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));
    await fetch("/api/pwa/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studioSlug: slug,
        subscription: subscription.toJSON(),
        pathPrefix: getPathPrefix(slug),
      }),
    });
  }

  async function unsubscribe() {
    setBusy(true);
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      setIsEnabled(false);
      setBusy(false);
      return;
    }
    const endpoint = subscription.endpoint;
    try {
      await fetch("/api/pwa/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studioSlug, endpoint }),
      });
      setIsEnabled(false);
      setShowPanel(false);
    } finally {
      setBusy(false);
    }
  }

  async function onEnable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);
      if (permission === "granted") {
        await subscribe(studioSlug, publicKey);
        setIsEnabled(true);
        setShowPanel(false);
      } else {
        setShowPanel(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!showPanel) return null;

  return (
    <div className="fixed bottom-32 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {isEnabled ? "Notifications are enabled" : "Enable notifications?"}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Get a system notification when this studio publishes new classes, events, packages, or member zone content.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {isEnabled ? (
              <button
                type="button"
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                onClick={() => void unsubscribe()}
                disabled={busy}
              >
                Turn off
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                onClick={() => void onEnable()}
                disabled={busy}
              >
                {busy ? "Enabling..." : "Enable"}
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300"
              onClick={() => {
                setShowPanel(false);
              }}
            >
              Close
            </button>
          </div>
          {!isEnabled && permission === "denied" ? (
            <p className="mt-2 text-[11px] text-stone-400 dark:text-stone-500">
              Notifications are blocked in browser settings for this site.
            </p>
          ) : null}
    </div>
  );
}

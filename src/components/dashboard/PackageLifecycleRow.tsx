"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

type Loc = { id: string; name: string };

export function PackageLifecycleRow({
  packageId,
  studioPublicSlug,
  shareSlug,
  isActive,
  canEdit,
  canCopyLink,
  initial,
  locations,
}: {
  packageId: string;
  studioPublicSlug: string | null;
  shareSlug: string | null;
  isActive: boolean;
  canEdit: boolean;
  canCopyLink: boolean;
  initial: {
    name: string;
    credits: number;
    price: number;
    expiry_days: number | null;
    location_id: string | null;
  };
  locations: Loc[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial.name);
  const [credits, setCredits] = useState(String(initial.credits));
  const [price, setPrice] = useState(String(initial.price));
  const [expiryDays, setExpiryDays] = useState(
    initial.expiry_days != null ? String(initial.expiry_days) : "",
  );
  const [locationId, setLocationId] = useState(initial.location_id ?? "");

  const copyPurchaseLink = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "package", entity_id: packageId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(body.error ?? "Could not build link");
      return;
    }
    if (body.url) {
      await navigator.clipboard.writeText(body.url);
      setMsg("Copied purchase link");
    }
  };

  const save = async () => {
    setMsg(null);
    setBusy(true);
    const creditsNum = Number(credits);
    const priceNum = Number(price);
    const expRaw = expiryDays.trim();
    const res = await fetch(`/api/dashboard/packages/${packageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        credits: creditsNum,
        price: priceNum,
        expiry_days: expRaw === "" ? null : Number(expRaw),
        location_id: locationId === "" ? null : locationId,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Save failed");
      return;
    }
    setMsg("Saved");
    router.refresh();
  };

  const stopSelling = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/dashboard/packages/${packageId}/disable`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Failed");
      return;
    }
    router.refresh();
  };

  const resume = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/dashboard/packages/${packageId}/restore`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Failed");
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isActive ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            Stopped
          </span>
        ) : null}
        {shareSlug && studioPublicSlug ? (
          <span className={`font-mono text-xs ${ui.muted}`}>
            /buy/{studioPublicSlug}/{shareSlug}
          </span>
        ) : null}
      </div>

      {canCopyLink ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !studioPublicSlug}
            className={`${ui.btnSecondarySm} disabled:opacity-50`}
            onClick={() => void copyPurchaseLink()}
          >
            Copy purchase link
          </button>
        </div>
      ) : null}

      {canEdit ? (
        <details className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
          <summary className="cursor-pointer text-sm font-medium text-stone-800 dark:text-stone-200">
            Edit
          </summary>
          <div className="mt-3 grid max-w-md gap-3">
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Name</span>
              <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Credits</span>
              <input
                className={ui.input}
                type="number"
                min={1}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Price</span>
              <input
                className={ui.input}
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Expiry days (empty = none)</span>
              <input
                className={ui.input}
                type="number"
                min={1}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Location (optional)</span>
              <select
                className={ui.select}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={busy} className={`${ui.btnPrimarySm} w-fit`} onClick={() => void save()}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </details>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {isActive ? (
            <button
              type="button"
              disabled={busy}
              className={`${ui.btnSecondarySm} border-amber-300 text-amber-900 dark:border-amber-700 dark:text-amber-200`}
              onClick={() => void stopSelling()}
            >
              Stop selling
            </button>
          ) : (
            <button type="button" disabled={busy} className={ui.btnPrimarySm} onClick={() => void resume()}>
              Resume
            </button>
          )}
        </div>
      ) : null}

      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

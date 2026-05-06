"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Pause, Play, Pencil, Trash2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { EntityCoverUpload } from "@/components/dashboard/EntityCoverUpload";
import { ui } from "@/lib/ui";

type Loc = { id: string; name: string };

export function PackageLifecycleRow({
  packageId,
  studioPublicSlug,
  shareSlug,
  isActive,
  canEdit,
  canCopyLink,
  coverImageUrl,
  initial,
  locations,
}: {
  packageId: string;
  studioPublicSlug: string | null;
  shareSlug: string | null;
  isActive: boolean;
  canEdit: boolean;
  canCopyLink: boolean;
  coverImageUrl: string | null;
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
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [name, setName] = useState(initial.name);
  const [credits, setCredits] = useState(String(initial.credits));
  const [price, setPrice] = useState(String(initial.price));
  const [expiryDays, setExpiryDays] = useState(
    initial.expiry_days != null ? String(initial.expiry_days) : "",
  );
  const [locationId, setLocationId] = useState(initial.location_id ?? "");

  const copyPurchaseLink = async () => {
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "package", entity_id: packageId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not build link");
      return;
    }
    if (body.url) {
      try {
        await navigator.clipboard.writeText(body.url);
        toast.success("Purchase link copied");
      } catch {
        toast.info(body.url);
      }
    }
  };

  const save = async () => {
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
      toast.error(body.error ?? "Save failed");
      return;
    }
    toast.success("Changes saved");
    router.refresh();
  };

  const stopSelling = async () => {
    setBusy(true);
    const res = await fetch(`/api/dashboard/packages/${packageId}/disable`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed");
      return;
    }
    toast.success("Package stopped");
    router.refresh();
  };

  const resume = async () => {
    setBusy(true);
    const res = await fetch(`/api/dashboard/packages/${packageId}/restore`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed");
      return;
    }
    toast.success("Package resumed");
    router.refresh();
  };

  const deletePackage = async () => {
    setBusy(true);
    setDeleteConfirm(false);
    const res = await fetch(`/api/dashboard/packages/${packageId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Delete failed");
      return;
    }
    toast.success("Package removed");
    router.refresh();
  };

  const showMeta = !isActive || (shareSlug && studioPublicSlug);

  return (
    <div className="flex flex-col gap-2">
      <EntityCoverUpload entity="package" entityId={packageId} imageUrl={coverImageUrl} canEdit={canEdit} />
      {showMeta ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canCopyLink ? (
          <button
            type="button"
            disabled={busy || !studioPublicSlug}
            className={`${ui.btnSecondarySm} disabled:opacity-50`}
            onClick={() => void copyPurchaseLink()}
          >
            <Copy size={13} />
            Copy purchase link
          </button>
        ) : null}

        {canEdit ? (
          <details className="chevron w-fit max-w-full rounded-md border border-stone-200 px-2 py-1 dark:border-stone-700 open:w-full open:px-2 open:py-2">
            <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-stone-800 dark:text-stone-200">
              <Pencil size={13} />
              Edit
            </summary>
            <div className="mt-2 grid max-w-md gap-2 border-t border-stone-100 pt-2 dark:border-stone-800">
              <label className="flex flex-col gap-1">
                <span className={ui.label}>Name</span>
                <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={ui.label}>Class passes</span>
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
                <Check size={13} />
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </details>
        ) : null}

        {canEdit ? (
          isActive ? (
            <button
              type="button"
              disabled={busy}
              className={`${ui.btnSecondarySm} border-amber-300 text-amber-900 dark:border-amber-700 dark:text-amber-200`}
              onClick={() => void stopSelling()}
            >
              <Pause size={13} />
              Stop selling
            </button>
          ) : (
            <button type="button" disabled={busy} className={ui.btnPrimarySm} onClick={() => void resume()}>
              <Play size={13} />
              Resume
            </button>
          )
        ) : null}
        {canEdit ? (
          deleteConfirm ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs dark:border-red-800/50 dark:bg-red-950/20">
              <AlertTriangle size={12} className="text-red-600 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300">Remove this package from the dashboard?</span>
              <button
                type="button"
                className="font-semibold text-red-700 hover:underline dark:text-red-400"
                onClick={() => void deletePackage()}
              >
                Yes, remove
              </button>
              <button type="button" className={ui.btnGhost} onClick={() => setDeleteConfirm(false)}>
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={`${ui.btnSecondarySm} border-red-300 text-red-700 dark:border-red-700 dark:text-red-300`}
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={13} />
              Remove
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

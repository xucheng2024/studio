"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Pencil, Trash2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { EntityCoverUpload } from "@/components/dashboard/EntityCoverUpload";
import { ui } from "@/lib/ui";

type Loc = { id: string; name: string };

export function PackageLifecycleRow({
  packageId,
  studioPublicSlug,
  shareSlug,
  canEdit,
  canCopyLink,
  coverImageUrl,
  initial,
  locations,
}: {
  packageId: string;
  studioPublicSlug: string | null;
  shareSlug: string | null;
  canEdit: boolean;
  canCopyLink: boolean;
  coverImageUrl: string | null;
  initial: {
    name: string;
    credits: number;
    price: number;
    expiry_days: number | null;
    location_id: string | null;
    video_url: string | null;
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
  const [videoUrl, setVideoUrl] = useState(initial.video_url ?? "");

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
        video_url: videoUrl.trim() === "" ? null : videoUrl.trim(),
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

  return (
    <div className="flex flex-col gap-2">
      {/* ── Main row: thumbnail + info + actions ── */}
      <div className="flex items-start gap-3">
        <EntityCoverUpload
          entity="package"
          entityId={packageId}
          imageUrl={coverImageUrl}
          canEdit={canEdit}
          size="thumb"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="font-medium text-stone-900 dark:text-stone-100">{initial.name}</p>
              {initial.credits != null || initial.price != null || initial.expiry_days != null ? (
                <p className={`mt-0.5 text-xs ${ui.muted}`}>
                  {initial.credits != null ? `${initial.credits} class passes` : ""}
                  {initial.credits != null && initial.price != null ? " · " : ""}
                  {initial.price != null ? `$${Number(initial.price).toFixed(2)}` : ""}
                  {initial.expiry_days != null ? ` · ${initial.expiry_days}d expiry` : ""}
                </p>
              ) : null}
              {shareSlug && studioPublicSlug ? (
                <p className={`mt-0.5 font-mono text-[11px] ${ui.muted}`}>
                  /buy/{studioPublicSlug}/{shareSlug}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {canCopyLink ? (
                <button
                  type="button"
                  disabled={busy || !studioPublicSlug}
                  className={`${ui.btnSecondarySm} disabled:opacity-50`}
                  onClick={() => void copyPurchaseLink()}
                >
                  <Copy size={12} />
                  <span className="hidden sm:inline">Copy link</span>
                </button>
              ) : null}

              {canEdit ? (
                deleteConfirm ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs dark:border-red-800/50 dark:bg-red-950/20">
                    <AlertTriangle size={11} className="shrink-0 text-red-600 dark:text-red-400" />
                    <button
                      type="button"
                      className="font-semibold text-red-700 hover:underline dark:text-red-400"
                      onClick={() => void deletePackage()}
                    >
                      Remove?
                    </button>
                    <button
                      type="button"
                      className="text-stone-400 hover:text-stone-600"
                      onClick={() => setDeleteConfirm(false)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className={`${ui.btnSecondarySm} border-red-200 text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50`}
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 size={12} />
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ── Edit panel ── */}
      {canEdit ? (
        <details className="chevron rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
            <Pencil size={12} />
            Edit package
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={ui.label}>Cover image</span>
              <div className="mt-2">
                <EntityCoverUpload
                  entity="package"
                  entityId={packageId}
                  imageUrl={coverImageUrl}
                  canEdit={canEdit}
                  size="full"
                />
              </div>
            </div>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Name</span>
              <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Class passes</span>
              <input className={ui.input} type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Price</span>
              <input className={ui.input} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Expiry days</span>
              <input className={ui.input} type="number" min={1} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} placeholder="empty = none" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Promo video URL</span>
              <input
                className={ui.input}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Location</span>
              <select className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} className={`${ui.btnPrimarySm} w-fit sm:col-span-2`} onClick={() => void save()}>
              <Check size={12} />
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { Check, Copy, Pencil, Trash2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Loc = { id: string; name: string };

export function MembershipLifecycleRow({
  membershipId,
  studioPublicSlug,
  shareSlug,
  canEdit,
  canCopyLink,
  initial,
  locations,
}: {
  membershipId: string;
  studioPublicSlug: string | null;
  shareSlug: string | null;
  canEdit: boolean;
  canCopyLink: boolean;
  initial: {
    name: string;
    description: string | null;
    price: number;
    billing_interval: "monthly" | "yearly";
    location_id: string | null;
    trial_days: number;
  };
  locations: Loc[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [price, setPrice] = useState(String(initial.price));
  const [billingInterval, setBillingInterval] = useState(initial.billing_interval);
  const [locationId, setLocationId] = useState(initial.location_id ?? "");
  const [trialEnabled, setTrialEnabled] = useState(initial.trial_days > 0);
  const [trialDays, setTrialDays] = useState(String(initial.trial_days > 0 ? initial.trial_days : 14));

  const copyPurchaseLink = async () => {
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "membership", entity_id: membershipId }),
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
        toast.success("Membership link copied");
      } catch {
        toast.info(body.url);
      }
    }
  };

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/dashboard/memberships/${membershipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description.trim() || null,
        price: Number(price),
        billing_interval: billingInterval,
        location_id: locationId || null,
        trial_days: trialEnabled ? Number(trialDays) : 0,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Save failed");
      return;
    }
    toast.success("Changes saved");
    throttledRefresh(router);
  };

  const removeMembership = async () => {
    setBusy(true);
    setDeleteConfirm(false);
    const res = await fetch(`/api/dashboard/memberships/${membershipId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Remove failed");
      return;
    }
    toast.success("Membership removed");
    throttledRefresh(router);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900 dark:text-stone-100">{initial.name}</p>
          <p className={`mt-0.5 text-xs ${ui.muted}`}>
            SGD {Number(initial.price).toFixed(2)} · {initial.billing_interval === "yearly" ? "Yearly" : "Monthly"}
          </p>
          {initial.trial_days > 0 ? (
            <p className={`mt-0.5 text-xs ${ui.muted}`}>{initial.trial_days}-day trial / guarantee</p>
          ) : null}
          {shareSlug && studioPublicSlug ? (
            <p className={`mt-0.5 font-mono text-[11px] ${ui.muted}`}>
              /{studioPublicSlug}/memberships/{shareSlug}
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
                  onClick={() => void removeMembership()}
                >
                  Remove?
                </button>
                <button type="button" className="text-stone-400 hover:text-stone-600" onClick={() => setDeleteConfirm(false)}>
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

      {initial.description ? <p className={`text-sm ${ui.muted}`}>{initial.description}</p> : null}

      {canEdit ? (
        <details className="chevron rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
            <Pencil size={12} />
            Edit membership
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Name</span>
              <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Description</span>
              <textarea className={ui.input} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Price (SGD)</span>
              <input className={ui.input} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Billing interval</span>
              <select className={ui.select} value={billingInterval} onChange={(e) => setBillingInterval(e.target.value as "monthly" | "yearly")}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Location</span>
              <select className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Trial</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={trialEnabled}
                    onChange={(e) => setTrialEnabled(e.target.checked)}
                    className="accent-teal-600"
                  />
                  Enable trial / refund guarantee
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                  <span className={ui.muted}>Days</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step="1"
                    value={trialDays}
                    onChange={(e) => setTrialDays(e.target.value)}
                    disabled={!trialEnabled}
                    className={`${ui.input} w-24 disabled:opacity-60`}
                  />
                </label>
              </div>
            </div>
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

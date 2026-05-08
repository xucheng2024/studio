"use client";

import { useMemo, useState } from "react";
import { ui } from "@/lib/ui";

type AccessType = "free" | "paid" | "members_only";
type LessonOverride = "inherit" | "free" | "paid" | "members_only";

function formatMoney(currency: string, price: number) {
  const safeCurrency = (currency || "SGD").toUpperCase();
  const safePrice = Number.isFinite(price) ? price : 0;
  return `${safeCurrency} ${safePrice.toFixed(2)}`;
}

function seriesBadge(accessType: AccessType, currency: string, price: number) {
  if (accessType === "free") return "Free";
  if (accessType === "members_only") return "Members only";
  return `Paid · ${formatMoney(currency, price)}`;
}

function seriesCta(accessType: AccessType, currency: string, price: number) {
  if (accessType === "free") return "Watch free";
  if (accessType === "members_only") return "Subscribe to unlock";
  return `Buy · ${formatMoney(currency, price)}`;
}

export function SeriesAccessPreview(props: {
  initialAccessType: AccessType;
  initialCurrency: string;
  initialPrice: number;
}) {
  const [accessType, setAccessType] = useState<AccessType>(props.initialAccessType);
  const [currency, setCurrency] = useState(props.initialCurrency || "SGD");
  const [price, setPrice] = useState(props.initialPrice ?? 0);

  const badge = useMemo(() => seriesBadge(accessType, currency, price), [accessType, currency, price]);
  const cta = useMemo(() => seriesCta(accessType, currency, price), [accessType, currency, price]);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <p className={`text-xs font-medium ${ui.muted}`}>Public preview <span className="font-normal">(standalone widget — does not affect form values)</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={ui.badgeNeutral}>{badge}</span>
        <span className={ui.btnPrimarySm}>{cta}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Access</span>
          <select
            className={ui.select}
            value={accessType}
            onChange={(e) => setAccessType(e.target.value as AccessType)}
          >
            <option value="members_only">Members only</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Currency</span>
          <input className={ui.input} value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Price</span>
          <input
            className={ui.input}
            type="number"
            min={0}
            step={0.01}
            value={String(price)}
            onChange={(e) => setPrice(Number(e.target.value || 0))}
          />
        </label>
      </div>
    </div>
  );
}

export function LessonAccessPreview(props: {
  initialSeriesAccessType: AccessType;
  initialSeriesCurrency: string;
  initialSeriesPrice: number;
  initialOverride: LessonOverride;
  initialOverrideCurrency: string;
  initialOverridePrice: number;
}) {
  const [seriesAccessType, setSeriesAccessType] = useState<AccessType>(props.initialSeriesAccessType);
  const [seriesCurrency, setSeriesCurrency] = useState(props.initialSeriesCurrency || "SGD");
  const [seriesPrice, setSeriesPrice] = useState(props.initialSeriesPrice ?? 0);

  const [override, setOverride] = useState<LessonOverride>(props.initialOverride);
  const [overrideCurrency, setOverrideCurrency] = useState(props.initialOverrideCurrency || "SGD");
  const [overridePrice, setOverridePrice] = useState(props.initialOverridePrice ?? 0);

  const resolvedAccessType: AccessType =
    override === "inherit" ? seriesAccessType : (override as AccessType);
  const resolvedCurrency = override === "paid" ? overrideCurrency : seriesCurrency;
  const resolvedPrice = override === "paid" ? overridePrice : seriesPrice;
  const badge = seriesBadge(resolvedAccessType, resolvedCurrency, resolvedPrice);
  const cta = seriesCta(resolvedAccessType, resolvedCurrency, resolvedPrice);
  const hint =
    override === "inherit" ? `Inherits series access (${badge})` : `Lesson override (${badge})`;

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <p className={`text-xs font-medium ${ui.muted}`}>Public preview <span className="font-normal">(standalone widget — does not affect form values)</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={ui.badgeNeutral}>{badge}</span>
        <span className={ui.btnPrimarySm}>{cta}</span>
      </div>
      <p className={`mt-2 text-xs ${ui.muted}`}>{hint}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Series access</span>
          <select className={ui.select} value={seriesAccessType} onChange={(e) => setSeriesAccessType(e.target.value as AccessType)}>
            <option value="members_only">Members only</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Series currency</span>
          <input className={ui.input} value={seriesCurrency} onChange={(e) => setSeriesCurrency(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Series price</span>
          <input className={ui.input} type="number" min={0} step={0.01} value={String(seriesPrice)} onChange={(e) => setSeriesPrice(Number(e.target.value || 0))} />
        </label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Lesson override</span>
          <select className={ui.select} value={override} onChange={(e) => setOverride(e.target.value as LessonOverride)}>
            <option value="inherit">Inherit series</option>
            <option value="members_only">Members only</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Override currency</span>
          <input className={ui.input} value={overrideCurrency} onChange={(e) => setOverrideCurrency(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Override price</span>
          <input className={ui.input} type="number" min={0} step={0.01} value={String(overridePrice)} onChange={(e) => setOverridePrice(Number(e.target.value || 0))} />
        </label>
      </div>
    </div>
  );
}

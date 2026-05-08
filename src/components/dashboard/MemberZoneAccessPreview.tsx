"use client";

import { useMemo, useState } from "react";
import { ui } from "@/lib/ui";

type AccessTypeV2 = "free" | "paid_only" | "member_only" | "member_or_paid";
type LessonOverride = "inherit" | AccessTypeV2;

function formatMoney(currency: string, price: number) {
  const safeCurrency = (currency || "SGD").toUpperCase();
  const safePrice = Number.isFinite(price) ? price : 0;
  return `${safeCurrency} ${safePrice.toFixed(2)}`;
}

function seriesBadge(accessType: AccessTypeV2, currency: string, price: number) {
  if (accessType === "free") return "Free";
  if (accessType === "member_only") return "Members only";
  if (accessType === "paid_only") return `Paid only · ${formatMoney(currency, price)}`;
  return `Member or paid · ${formatMoney(currency, price)}`;
}

function seriesCta(accessType: AccessTypeV2, currency: string, price: number) {
  if (accessType === "free") return "Watch free";
  if (accessType === "member_only") return "Subscribe to unlock";
  if (accessType === "paid_only") return `Buy only · ${formatMoney(currency, price)}`;
  return `Buy or subscribe · ${formatMoney(currency, price)}`;
}

export function SeriesAccessPreview(props: {
  initialAccessType: AccessTypeV2;
  initialCurrency: string;
  initialPrice: number;
}) {
  const [accessType, setAccessType] = useState<AccessTypeV2>(props.initialAccessType);
  const [currency, setCurrency] = useState(props.initialCurrency || "SGD");
  const [price, setPrice] = useState(props.initialPrice ?? 0);

  const badge = useMemo(() => seriesBadge(accessType, currency, price), [accessType, currency, price]);
  const cta = useMemo(() => seriesCta(accessType, currency, price), [accessType, currency, price]);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <p className={`text-xs font-medium ${ui.muted}`}>Public preview</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={ui.badgeNeutral}>{badge}</span>
        <span className={ui.btnPrimarySm}>{cta}</span>
      </div>
    </div>
  );
}

export function LessonAccessPreview(props: {
  initialSeriesAccessType: AccessTypeV2;
  initialSeriesCurrency: string;
  initialSeriesPrice: number;
  initialOverride: LessonOverride;
  initialOverrideCurrency: string;
  initialOverridePrice: number;
}) {
  const [seriesAccessType, setSeriesAccessType] = useState<AccessTypeV2>(props.initialSeriesAccessType);
  const [seriesCurrency, setSeriesCurrency] = useState(props.initialSeriesCurrency || "SGD");
  const [seriesPrice, setSeriesPrice] = useState(props.initialSeriesPrice ?? 0);

  const [override, setOverride] = useState<LessonOverride>(props.initialOverride);
  const [overrideCurrency, setOverrideCurrency] = useState(props.initialOverrideCurrency || "SGD");
  const [overridePrice, setOverridePrice] = useState(props.initialOverridePrice ?? 0);

  const resolvedAccessType: AccessTypeV2 =
    override === "inherit" ? seriesAccessType : override;
  const overrideIsPaid = override === "paid_only" || override === "member_or_paid";
  const resolvedCurrency = overrideIsPaid ? overrideCurrency : seriesCurrency;
  const resolvedPrice = overrideIsPaid ? overridePrice : seriesPrice;
  const badge = seriesBadge(resolvedAccessType, resolvedCurrency, resolvedPrice);
  const cta = seriesCta(resolvedAccessType, resolvedCurrency, resolvedPrice);
  const hint =
    override === "inherit" ? `Inherits series access (${badge})` : `Lesson override (${badge})`;

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <p className={`text-xs font-medium ${ui.muted}`}>Public preview</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={ui.badgeNeutral}>{badge}</span>
        <span className={ui.btnPrimarySm}>{cta}</span>
      </div>
      <p className={`mt-2 text-xs ${ui.muted}`}>{hint}</p>
    </div>
  );
}

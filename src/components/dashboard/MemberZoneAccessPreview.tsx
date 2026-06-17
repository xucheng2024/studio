"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { ui } from "@/lib/ui";

type AccessTypeV2 = "free" | "paid_only" | "member_only" | "member_or_paid";
type LessonOverride = "inherit" | AccessTypeV2;

function readFieldValue(form: HTMLFormElement, name: string, fallback: string): string {
  const field = form.elements.namedItem(name);
  if (!field) return fallback;
  if (field instanceof RadioNodeList) return String(field.value || fallback);
  if ("value" in field) return String((field as HTMLInputElement | HTMLSelectElement).value ?? fallback);
  return fallback;
}

function readPriceValue(form: HTMLFormElement, name: string, fallback: number): number {
  const raw = readFieldValue(form, name, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(price: number) {
  const safePrice = Number.isFinite(price) ? price : 0;
  return `${STUDIO_CURRENCY} ${safePrice.toFixed(2)}`;
}

function seriesBadge(accessType: AccessTypeV2, price: number) {
  if (accessType === "free") return "Free";
  if (accessType === "member_only") return "Members only";
  if (accessType === "paid_only") return `Paid only · ${formatMoney(price)}`;
  return `Member or paid · ${formatMoney(price)}`;
}

function seriesCta(accessType: AccessTypeV2, price: number) {
  if (accessType === "free") return "Watch free";
  if (accessType === "member_only") return "Subscribe to unlock";
  if (accessType === "paid_only") return `Buy only · ${formatMoney(price)}`;
  return `Buy or subscribe · ${formatMoney(price)}`;
}

export function SeriesAccessPreview(props: {
  initialAccessType: AccessTypeV2;
  initialPrice: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [accessType, setAccessType] = useState<AccessTypeV2>(props.initialAccessType);
  const [price, setPrice] = useState(props.initialPrice ?? 0);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;

    const syncFromForm = () => {
      const nextAccessType = readFieldValue(form, "access_type", props.initialAccessType) as AccessTypeV2;
      const nextPrice = readPriceValue(form, "price", props.initialPrice ?? 0);
      setAccessType(nextAccessType);
      setPrice(nextPrice);
    };

    syncFromForm();
    form.addEventListener("input", syncFromForm);
    form.addEventListener("change", syncFromForm);
    return () => {
      form.removeEventListener("input", syncFromForm);
      form.removeEventListener("change", syncFromForm);
    };
  }, [props.initialAccessType, props.initialPrice]);

  const badge = useMemo(() => seriesBadge(accessType, price), [accessType, price]);
  const cta = useMemo(() => seriesCta(accessType, price), [accessType, price]);

  return (
    <div ref={containerRef} className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
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
  initialSeriesPrice: number;
  initialOverride: LessonOverride;
  initialOverridePrice: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [seriesAccessType] = useState<AccessTypeV2>(props.initialSeriesAccessType);
  const [seriesPrice] = useState(props.initialSeriesPrice ?? 0);

  const [override, setOverride] = useState<LessonOverride>(props.initialOverride);
  const [overridePrice, setOverridePrice] = useState(props.initialOverridePrice ?? 0);

  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form) return;

    const syncFromForm = () => {
      const nextOverride = readFieldValue(form, "access_override", props.initialOverride) as LessonOverride;
      const nextOverridePrice = readPriceValue(form, "override_price", props.initialOverridePrice ?? 0);

      setOverride(nextOverride);
      setOverridePrice(nextOverridePrice);
    };

    syncFromForm();
    form.addEventListener("input", syncFromForm);
    form.addEventListener("change", syncFromForm);
    return () => {
      form.removeEventListener("input", syncFromForm);
      form.removeEventListener("change", syncFromForm);
    };
  }, [props.initialOverride, props.initialOverridePrice]);

  const resolvedAccessType: AccessTypeV2 =
    override === "inherit" ? seriesAccessType : override;
  const overrideIsPaid = override === "paid_only" || override === "member_or_paid";
  const resolvedPrice = overrideIsPaid ? overridePrice : seriesPrice;
  const badge = seriesBadge(resolvedAccessType, resolvedPrice);
  const cta = seriesCta(resolvedAccessType, resolvedPrice);
  const hint =
    override === "inherit" ? `Inherits series access (${badge})` : `Lesson override (${badge})`;

  return (
    <div ref={containerRef} className="rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <p className={`text-xs font-medium ${ui.muted}`}>Public preview</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={ui.badgeNeutral}>{badge}</span>
        <span className={ui.btnPrimarySm}>{cta}</span>
      </div>
      <p className={`mt-2 text-xs ${ui.muted}`}>{hint}</p>
    </div>
  );
}

import { STUDIO_CURRENCY } from "@/lib/currency";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import type { SupabaseClient } from "@supabase/supabase-js";

type AccessType = "free" | "paid_only" | "member_only" | "member_or_paid";
type Scope = "series" | "lesson";

export type MemberZoneAccessResult = {
  canPlay: boolean;
  reason: "free" | "membership" | "purchased" | "purchase_required" | "auth_required";
  resolvedAccessType: AccessType;
  resolvedPrice: number;
  resolvedCurrency: string;
  purchaseScope: Scope;
};

export function isPurchaseEnabledAccessType(accessType: AccessType) {
  return accessType === "paid_only" || accessType === "member_or_paid";
}

export function isMembershipEnabledAccessType(accessType: AccessType) {
  return accessType === "member_only" || accessType === "member_or_paid";
}

export function normalizeMemberZoneAccessType(raw: string | null | undefined): AccessType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "free" || value === "paid_only" || value === "member_only" || value === "member_or_paid") {
    return value;
  }
  if (value === "paid") return "member_or_paid";
  if (value === "members_only") return "member_only";
  return "member_only";
}

export function normalizeMemberZoneLessonOverride(
  raw: string | null | undefined,
): "inherit" | AccessType {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "inherit") return "inherit";
  return normalizeMemberZoneAccessType(value);
}

export function resolveMemberZoneAccessRule(input: {
  seriesAccessType: string | null | undefined;
  seriesPrice: number | null | undefined;
  seriesCurrency?: string | null | undefined;
  lessonAccessOverride: string | null | undefined;
  lessonOverridePrice: number | null | undefined;
  lessonCurrency?: string | null | undefined;
}) {
  const override = normalizeMemberZoneLessonOverride(input.lessonAccessOverride);
  const baseType = normalizeMemberZoneAccessType(input.seriesAccessType);
  const resolvedAccessType: AccessType = override === "inherit" ? baseType : override;
  const resolvedPrice =
    isPurchaseEnabledAccessType(resolvedAccessType)
      ? Math.max(
          0,
          Number(
            override !== "inherit" && isPurchaseEnabledAccessType(override)
              ? input.lessonOverridePrice ?? 0
              : input.seriesPrice ?? 0,
          ),
        )
      : 0;
  const resolvedCurrency = STUDIO_CURRENCY;
  const purchaseScope: Scope =
    override !== "inherit" && isPurchaseEnabledAccessType(override) ? "lesson" : "series";
  return { resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope };
}

export async function resolveMemberZonePlaybackAccess(
  admin: SupabaseClient,
  input: {
    userId: string | null;
    studioId: string;
    seriesId: string;
    lessonId: string;
    seriesAccessType: string | null | undefined;
    seriesPrice: number | null | undefined;
    seriesCurrency?: string | null | undefined;
    lessonAccessOverride: string | null | undefined;
    lessonOverridePrice: number | null | undefined;
    lessonCurrency?: string | null | undefined;
  },
): Promise<MemberZoneAccessResult> {
  const { resolvedAccessType, resolvedPrice, resolvedCurrency, purchaseScope } =
    resolveMemberZoneAccessRule(input);
  if (resolvedAccessType === "free") {
    return {
      canPlay: true,
      reason: "free",
      resolvedAccessType,
      resolvedPrice,
      resolvedCurrency,
      purchaseScope,
    };
  }
  if (!input.userId) {
    return {
      canPlay: false,
      reason: "auth_required",
      resolvedAccessType,
      resolvedPrice,
      resolvedCurrency,
      purchaseScope,
    };
  }

  const { data: membershipRows } = await admin
    .from("customer_subscriptions")
    .select("status, cancel_at_period_end, current_period_end")
    .eq("studio_id", input.studioId)
    .eq("client_id", input.userId)
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"]);
  const hasMembership = (membershipRows ?? []).some((row) =>
    isMembershipActiveForAccess(row),
  );
  if (hasMembership) {
    if (!isMembershipEnabledAccessType(resolvedAccessType)) {
      return {
        canPlay: false,
        reason: "purchase_required",
        resolvedAccessType,
        resolvedPrice,
        resolvedCurrency,
        purchaseScope,
      };
    }
    return {
      canPlay: true,
      reason: "membership",
      resolvedAccessType,
      resolvedPrice,
      resolvedCurrency,
      purchaseScope,
    };
  }

  const { data: purchaseRows } = await admin
    .from("member_zone_purchases")
    .select("series_id, lesson_id")
    .eq("studio_id", input.studioId)
    .eq("client_id", input.userId)
    .eq("status", "paid")
    .or(`and(series_id.eq.${input.seriesId},lesson_id.is.null),lesson_id.eq.${input.lessonId}`);
  const hasPaidSeries = (purchaseRows ?? []).some(
    (row) => row.series_id === input.seriesId && !row.lesson_id,
  );
  const hasPaidLesson = (purchaseRows ?? []).some(
    (row) => row.lesson_id === input.lessonId,
  );
  if (hasPaidSeries || hasPaidLesson) {
    return {
      canPlay: true,
      reason: "purchased",
      resolvedAccessType,
      resolvedPrice,
      resolvedCurrency,
      purchaseScope,
    };
  }

  return {
    canPlay: false,
    reason: "purchase_required",
    resolvedAccessType,
    resolvedPrice,
    resolvedCurrency,
    purchaseScope,
  };
}

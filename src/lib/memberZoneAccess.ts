import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import type { SupabaseClient } from "@supabase/supabase-js";

type AccessType = "free" | "paid" | "members_only";
type Scope = "series" | "lesson";

export type MemberZoneAccessResult = {
  canPlay: boolean;
  reason: "free" | "membership" | "purchased" | "purchase_required" | "auth_required";
  resolvedAccessType: AccessType;
  resolvedPrice: number;
  resolvedCurrency: string;
  purchaseScope: Scope;
};

export function resolveMemberZoneAccessRule(input: {
  seriesAccessType: string | null | undefined;
  seriesPrice: number | null | undefined;
  seriesCurrency: string | null | undefined;
  lessonAccessOverride: string | null | undefined;
  lessonOverridePrice: number | null | undefined;
  lessonCurrency: string | null | undefined;
}) {
  const override = String(input.lessonAccessOverride ?? "inherit").toLowerCase();
  const baseType = String(input.seriesAccessType ?? "members_only").toLowerCase();
  const resolvedAccessType: AccessType =
    override === "free" || override === "paid" || override === "members_only"
      ? (override as AccessType)
      : baseType === "free" || baseType === "paid" || baseType === "members_only"
        ? (baseType as AccessType)
        : "members_only";
  const resolvedPrice =
    resolvedAccessType === "paid"
      ? Math.max(
          0,
          Number(
            override === "paid"
              ? input.lessonOverridePrice ?? 0
              : input.seriesPrice ?? 0,
          ),
        )
      : 0;
  const resolvedCurrency = String(
    (override === "paid" ? input.lessonCurrency : input.seriesCurrency) ?? "SGD",
  ).toUpperCase();
  const purchaseScope: Scope = override === "paid" ? "lesson" : "series";
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
    seriesCurrency: string | null | undefined;
    lessonAccessOverride: string | null | undefined;
    lessonOverridePrice: number | null | undefined;
    lessonCurrency: string | null | undefined;
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

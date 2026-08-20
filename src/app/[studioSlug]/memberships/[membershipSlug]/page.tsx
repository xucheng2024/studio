import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MembershipReturnNotice } from "@/components/MembershipReturnNotice";
import { PurchaseAccountHint } from "@/components/PurchaseAccountHint";
import { SubscribeMembershipPanel } from "@/components/SubscribeMembershipPanel";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { getCachedMembershipShareContext } from "@/lib/cachedSharePages";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { studioMembershipsPath } from "@/lib/public-paths";
import { buildMembershipShareMetadata } from "@/lib/publicShareOg";
import { getLatestSalonTermsVersion, summarizeTermsSnapshot } from "@/lib/salon-appointments-self";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string; membershipSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, membershipSlug } = await params;
  return buildMembershipShareMetadata(studioSlug, membershipSlug);
}

export default async function PublicMembershipPage({ params }: Props) {
  const { studioSlug: rawStudio, membershipSlug: rawMembership } = await params;
  const ctx = await getCachedMembershipShareContext(rawStudio ?? "", rawMembership ?? "");
  if (!ctx) notFound();
  const { studio, membership } = ctx;

  const paymentReady = Boolean((studio as { hitpay_enabled?: boolean | null }).hitpay_enabled);
  const studioPublicSlug = studio.public_slug ?? rawStudio;
  const membershipCurrency = STUDIO_CURRENCY;
  const intervalLabel = membership.billing_interval === "yearly" ? "Yearly" : "Monthly";
  const trialDays = Number((membership as { trial_days?: number | null }).trial_days ?? 0);
  const billingStartLabel =
    trialDays > 0
      ? (() => {
          const now = new Date();
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Singapore",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).formatToParts(now);
          const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
          const today = `${pick("year")}-${pick("month")}-${pick("day")}`;
          const base = new Date(`${today}T00:00:00+08:00`);
          base.setDate(base.getDate() + Math.max(0, Math.floor(trialDays)));
          return base.toLocaleDateString("en-SG", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Singapore" });
        })()
      : null;
  const intervalShort = intervalLabel.toLowerCase() === "yearly" ? "year" : "month";
  const termsVersion = await getLatestSalonTermsVersion({ studioId: studio.id });
  const termsSummary = summarizeTermsSnapshot(termsVersion?.content_snapshot ?? null);

  return (
    <main className={ui.page}>
      <Suspense fallback={null}>
        <MembershipReturnNotice studioSlug={studioPublicSlug} />
      </Suspense>
      <div className="mb-4">
        <StudioPublicBackNav href={studioMembershipsPath(studioPublicSlug)}>Back to memberships</StudioPublicBackNav>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <h1 className={ui.h1}>{membership.name}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
          {trialDays > 0 ? (
            <p className="mt-3 inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300">
              Free for {trialDays} days
            </p>
          ) : null}
          <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {membershipCurrency} {Number(membership.price ?? 0).toFixed(2)}
            <span className="ml-2 text-base font-medium text-stone-500 dark:text-stone-400">/ {intervalLabel.toLowerCase().replace("ly", "")}</span>
          </p>
          {trialDays > 0 && billingStartLabel ? (
            <p className={`mt-2 text-sm ${ui.muted}`}>
              You won’t be charged today. Your first payment will be on <span className="font-medium text-stone-700 dark:text-stone-200">{billingStartLabel}</span>, then {membershipCurrency}{" "}
              {Number(membership.price ?? 0).toFixed(2)} per {intervalShort} after that.
            </p>
          ) : null}
          {membership.description ? (
            <div className={`mt-6 max-w-xl whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300`}>
              {membership.description}
            </div>
          ) : null}
          {!paymentReady ? (
            <p className={`mt-4 text-sm ${ui.error}`}>Online payment is not configured for this studio.</p>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Subscribe</p>
            <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
              {paymentReady
                ? "Recurring billing is set up on HitPay with a card."
                : "Online payment is not configured for this studio."}
            </p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {membershipCurrency} {Number(membership.price ?? 0).toFixed(2)}
            </p>
            <p className={`mt-1 text-sm ${ui.muted}`}>{intervalLabel} membership</p>
            <div className="mt-5">
              <SubscribeMembershipPanel
                membershipId={membership.id}
                studioSlug={studioPublicSlug}
                disabled={!paymentReady}
                termsVersion={termsVersion ? { id: termsVersion.id, version_label: termsVersion.version_label } : null}
                termsSummary={termsSummary}
              />
            </div>
            <PurchaseAccountHint className="mt-4" />
          </div>
        </div>
      </div>
    </main>
  );
}

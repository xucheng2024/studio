import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { SubscribeMembershipPanel } from "@/components/SubscribeMembershipPanel";
import { getCachedMembershipShareContext } from "@/lib/cachedSharePages";
import { buildMembershipShareMetadata } from "@/lib/publicShareOg";
import { getVideoPreview } from "@/lib/videoPreview";
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
  const coverSrc = (membership as { image_url?: string | null }).image_url ?? null;
  const videoUrl = (membership as { video_url?: string | null }).video_url ?? null;
  const videoPreview = getVideoPreview(videoUrl ?? "");
  const studioPublicSlug = studio.public_slug ?? rawStudio;
  const membershipSlugPath = (membership as { share_slug?: string | null }).share_slug ?? rawMembership;
  const sharePath = `/membership/${studioPublicSlug}/${membershipSlugPath}`;
  const intervalLabel = membership.billing_interval === "yearly" ? "Yearly" : "Monthly";
  const trialDays = Number((membership as { trial_days?: number | null }).trial_days ?? 0);

  return (
    <main className={ui.page}>
      {videoPreview.embedUrl || (videoUrl && videoUrl.trim()) ? (
        <div className="mb-6">
          <PublicVideoCover
            title={membership.name}
            coverUrl={coverSrc}
            embedUrl={videoPreview.embedUrl}
            fallbackUrl={videoUrl?.trim() || null}
          />
        </div>
      ) : (
        <ShareCoverImage
          src={coverSrc}
          alt={membership.name}
          sharePath={sharePath}
          shareTitle={membership.name}
          shareText={`${membership.name} · ${studio.name} · ${intervalLabel} membership`}
        />
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <p className={ui.badge}>Membership</p>
          <h1 className={`${ui.h1} mt-3`}>{membership.name}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
          {trialDays > 0 ? (
            <p className="mt-3 inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300">
              {trialDays}-day trial / refund guarantee
            </p>
          ) : null}
          <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            SGD {Number(membership.price ?? 0).toFixed(2)}
            <span className="ml-2 text-base font-medium text-stone-500 dark:text-stone-400">/ {intervalLabel.toLowerCase().replace("ly", "")}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600 dark:text-stone-300">
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              Automatic {intervalLabel.toLowerCase()} billing
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              Cancelled by the studio on request
            </span>
          </div>
          {membership.description ? (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              {membership.description}
            </p>
          ) : null}
          <p className={`mt-4 text-sm ${paymentReady ? ui.muted : ui.error}`}>
            {paymentReady ? "Secure recurring billing powered by HitPay." : "Online payment is not configured for this studio."}
          </p>
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Start this membership</p>
            <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
              {paymentReady ? "Attach a payment method once, then future renewals bill automatically." : "Online payment is not configured for this studio."}
            </p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              SGD {Number(membership.price ?? 0).toFixed(2)}
            </p>
            <p className={`mt-1 text-sm ${ui.muted}`}>{intervalLabel} membership</p>
            <div className="mt-5">
              <SubscribeMembershipPanel
                membershipId={membership.id}
                studioSlug={studioPublicSlug}
                membershipSlug={membershipSlugPath}
                disabled={!paymentReady}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

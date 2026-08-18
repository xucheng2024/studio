import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioPrivacyPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { getLatestPrivacyNotice, type PrivacyNoticeSnapshot } from "@/lib/studio-privacy";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };

export const dynamic = "force-dynamic";

function asSnapshot(value: unknown): PrivacyNoticeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PrivacyNoticeSnapshot>;
  if (!Array.isArray(row.collected) || !Array.isArray(row.purposes) || typeof row.body !== "string") {
    return null;
  }
  return {
    templateId: typeof row.templateId === "string" ? row.templateId : "",
    collected: row.collected.map((item) => String(item)),
    purposes: row.purposes.map((item) => String(item)),
    processors: Array.isArray(row.processors)
      ? row.processors.map((item) => ({
        name: String((item as { name?: string }).name ?? ""),
        purpose: String((item as { purpose?: string }).purpose ?? ""),
      }))
      : [],
    body: row.body,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Privacy notice",
    description: "What this studio collects, who uses it, and the notice version.",
    path: studioPrivacyPath(studioSlug),
  });
}

export default async function StudioPrivacyPage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const notice = await getLatestPrivacyNotice({ studioId: studio.id });
  const snapshot = asSnapshot(notice?.content_snapshot ?? null);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={studioHomePath(studio.public_slug)}>Back to studio</StudioPublicBackNav>
      <div className="mt-4">
        <h1 className={ui.h1}>Privacy notice</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {notice?.version_label
            ? `Version ${notice.version_label} · ${studio.name}`
            : `${studio.name} has not published a privacy notice yet.`}
        </p>
      </div>

      {snapshot ? (
        <div className="mt-6 flex flex-col gap-4">
          <section className={ui.card}>
            <h2 className={ui.h2}>What we collect</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
              {snapshot.collected.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className={ui.card}>
            <h2 className={ui.h2}>Who uses it</h2>
            <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">This studio uses the data for:</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
              {snapshot.purposes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className={ui.card}>
            <h2 className={ui.h2}>Processors</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-stone-700 dark:text-stone-300">
              {snapshot.processors.map((processor) => (
                <li key={processor.name}>
                  <span className="font-medium text-stone-900 dark:text-stone-100">{processor.name}</span>
                  <span className={`block ${ui.muted}`}>{processor.purpose}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className={ui.card}>
            <h2 className={ui.h2}>Details</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700 dark:text-stone-300">{snapshot.body}</p>
          </section>
        </div>
      ) : (
        <p className={`mt-6 ${ui.muted}`}>Ask the front desk if you need a copy of this studio&apos;s privacy notice.</p>
      )}
    </main>
  );
}

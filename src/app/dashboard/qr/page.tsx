import QRCode from "qrcode";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { updateStudioSlug } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string }> };

export default async function QrPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { studioIds } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
  });

  const { data: studios } = await supabase
    .from("studios")
    .select("id, name, public_slug")
    .in("id", studioIds);

  const studio = sp.studio_id ? studios?.find((s) => s.id === sp.studio_id) ?? null : null;

  if (!studio) {
    return (
      <div className="max-w-md space-y-2">
        <p className={ui.muted}>
          {studios?.length
            ? "Select a studio from the sidebar to generate QR."
            : "Create your studio on the overview first, then return here for your QR link."}
        </p>
      </div>
    );
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (host ? `${proto}://${host}` : "");
  const path = `/booking/${studio.public_slug}`;
  const bookingUrl = base ? `${base}${path}` : path;

  const dataUrl = await QRCode.toDataURL(bookingUrl, {
    width: 280,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return (
    <div className="flex max-w-lg flex-col gap-8">
      <div>
        <h1 className={ui.h1}>QR booking</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Print or share. Members scan, see classes, then book with name + email only.
        </p>
        {(studios?.length ?? 0) > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(studios ?? []).map((s) => (
              <Link
                key={s.id}
                href={`/dashboard/qr?studio_id=${s.id}`}
                className={s.id === studio.id ? ui.btnSecondarySm : ui.linkMuted}
              >
                {s.name}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {!base ? (
        <div
          className="rounded-xl border border-amber-200/60 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
        >
          Set <code className={ui.code}>NEXT_PUBLIC_APP_URL</code> in production so the QR uses a
          full <code className={ui.code}>https://…</code> URL (better for phone cameras).
        </div>
      ) : null}

      <div className={`${ui.card} flex flex-col items-start gap-4`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} width={280} height={280} alt="" className="rounded-lg" />
        <div className="flex w-full min-w-0 flex-col gap-2 text-sm">
          <span className={`text-xs font-medium uppercase tracking-wide ${ui.muted}`}>URL</span>
          <a className={`${ui.link} break-all`} href={bookingUrl}>
            {bookingUrl}
          </a>
          <a
            className={`${ui.btnSecondarySm} mt-2 inline-flex w-fit`}
            href={dataUrl}
            download={`booking-qr-${studio.public_slug}.png`}
          >
            Download PNG
          </a>
        </div>
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Change public slug</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>
          Lowercase letters, numbers, hyphens. Min 3 characters. Path:{" "}
          <code className={ui.code}>/booking/your-slug</code>
        </p>
        <form action={updateStudioSlug} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="studio_id" value={studio.id} />
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className={ui.label}>Slug</span>
            <input
              name="public_slug"
              required
              minLength={3}
              maxLength={60}
              pattern="[a-z0-9-]+"
              defaultValue={studio.public_slug}
              className={`${ui.input} font-mono text-sm`}
            />
          </label>
          <SubmitButton className={ui.btnPrimary} pendingText="Saving...">
            Save
          </SubmitButton>
        </form>
        <p className={`mt-3 text-xs ${ui.muted}`}>
          Normalized:{" "}
          <code className={ui.code}>
            {normalizeStudioSlug(studio.public_slug) ?? studio.public_slug}
          </code>
        </p>
      </div>

      <Link href={path} className={`${ui.btnSecondary} inline-flex w-fit`}>
        Open public booking page
      </Link>
    </div>
  );
}

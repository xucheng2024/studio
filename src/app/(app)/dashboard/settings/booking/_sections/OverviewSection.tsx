import { applyRecommendedBookingSetupAction } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getBookingReadiness } from "@/lib/booking-setup";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { bookingHref, type BookingSettingsContext } from "./context";

export async function OverviewSection({ ctx }: { ctx: BookingSettingsContext }) {
  const [readiness, studioRes] = await Promise.all([
    getBookingReadiness({ studioId: ctx.studioId }),
    createAdminClient().from("studios").select("public_slug").eq("id", ctx.studioId).maybeSingle<{ public_slug: string | null }>(),
  ]);
  const publicSlug = studioRes.data?.public_slug ?? null;
  const bookableCount = readiness.services.filter((service) => service.bookable).length;
  const blockedServices = readiness.services.filter((service) => !service.bookable);
  const hasGaps = readiness.items.some((item) => !item.done);
  const linkFor = (href: string) => bookingHref({ selectedStudioId: ctx.selectedStudioId, locationId: null }, {}, href);

  return (
    <div className="flex flex-col gap-4">
      <section className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={ui.h2}>{readiness.ready ? "Online booking is ready" : "Online booking needs setup"}</h2>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              {readiness.hasServices
                ? `${bookableCount} of ${readiness.services.length} active services can be booked online.`
                : "Add an active service first."}
            </p>
          </div>
          {publicSlug ? (
            <a href={`/${publicSlug}/appointments`} target="_blank" rel="noreferrer" className={ui.btnSecondarySm}>
              Open booking page
            </a>
          ) : null}
        </div>

        {!readiness.hasLocations || !readiness.hasEmployees ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {!readiness.hasLocations ? "Add a location first. " : ""}
            {!readiness.hasEmployees ? "Add at least one staff member so customers have someone to book with." : ""}
          </p>
        ) : null}

        {hasGaps ? (
          <ServerActionToastForm action={applyRecommendedBookingSetupAction} className="flex flex-col gap-2 rounded-xl bg-teal-50 p-3 dark:bg-teal-950/30">
            <input type="hidden" name="studio_id" value={ctx.studioId} />
            <p className="text-sm text-stone-700 dark:text-stone-200">
              Fill only what is missing: open every day 10:00–20:00, staff work during opening hours, all staff can do all services at all locations, and default booking terms. Nothing you already set is changed.
            </p>
            <div>
              <SubmitButton className={ui.btnPrimarySm} pendingText="Setting up...">Use recommended setup</SubmitButton>
            </div>
          </ServerActionToastForm>
        ) : null}
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Checklist</h2>
        <ul className="mt-3 flex flex-col divide-y divide-stone-100 dark:divide-stone-800">
          {readiness.items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-stone-900 dark:text-stone-100">
                  <span aria-hidden="true" className={item.done ? "text-teal-600" : "text-amber-600"}>{item.done ? "✓" : "!"}</span>
                  {item.label}
                </p>
                {!item.done ? (
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    Missing: {item.issues.slice(0, 4).map((issue) => issue.label).join(", ")}
                    {item.issues.length > 4 ? ` and ${item.issues.length - 4} more` : ""}
                  </p>
                ) : null}
              </div>
              <DashboardAppLink href={linkFor(item.href)} className={`${ui.linkMuted} shrink-0 text-xs`}>
                {item.done ? "Adjust" : "Fix"}
              </DashboardAppLink>
            </li>
          ))}
        </ul>
      </section>

      {blockedServices.length ? (
        <section className={ui.card}>
          <h2 className={ui.h2}>Not bookable yet</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {blockedServices.map((service) => (
              <li key={service.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-stone-900 dark:text-stone-100">{service.name}</span>
                <span className={ui.muted}>{service.reason ?? "Booking terms or privacy consent missing"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

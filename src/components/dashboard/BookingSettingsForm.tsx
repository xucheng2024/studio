"use client";

import { useActionState } from "react";
import { ExternalLink, CalendarDays, CheckCircle2, AlertCircle } from "lucide-react";
import { updateStudioBookingSettings, type BookingSettingsResult } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ui } from "@/lib/ui";

type Props = {
  studioId: string;
  initialEnabled: boolean;
  initialUrl: string | null;
};

export function BookingSettingsForm({ studioId, initialEnabled, initialUrl }: Props) {
  const [state, formAction] = useActionState<BookingSettingsResult | null, FormData>(
    updateStudioBookingSettings,
    null,
  );
  const displayEnabled = state?.ok && state.enabled !== undefined ? state.enabled : initialEnabled;
  const displayUrl = state?.ok && state.url !== undefined ? state.url : initialUrl;
  const statusLabel = displayEnabled && displayUrl
    ? "Booking live on public page"
    : displayUrl
      ? "Link saved but disabled"
      : "Not configured";
  const statusClass = displayEnabled && displayUrl
    ? ui.badge
    : displayUrl
      ? ui.badgeAmber
      : ui.badgeNeutral;

  return (
    <form action={formAction} className={`${ui.card} grid gap-5`}>
      <input type="hidden" name="studio_id" value={studioId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={ui.h2}>Booking settings</h2>
          <p className={`mt-1 text-sm ${ui.muted}`}>
            Connect Cal.com so visitors can book directly from your public studio page.
          </p>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="grid content-start gap-4">
          <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-700">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-teal-600 dark:text-teal-400" />
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">In this app</h3>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="calcom_booking_enabled"
                defaultChecked={initialEnabled}
              />
              Show booking on the public page
            </label>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className={ui.label}>Cal.com booking or embed URL</span>
              <input
                name="calcom_embed_url"
                className={ui.input}
                defaultValue={initialUrl ?? ""}
                placeholder="https://cal.com/your-team/discovery-call"
              />
              <p className={`text-xs ${ui.muted}`}>
                Paste the exact Cal.com URL for the event you want visitors to book. We accept secure
                <span className={ui.code}> cal.com </span>
                links only.
              </p>
            </label>
          </div>

          {state ? (
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                state.ok
                  ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/30 dark:text-teal-300"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {state.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                {state.message}
              </span>
            </div>
          ) : null}

          <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Saving...">
            Save booking settings
          </SubmitButton>
        </div>

        <div className="grid content-start gap-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-700 dark:bg-stone-950/40">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">How to set it up in Cal.com</h3>
            <ol className={`mt-3 list-decimal space-y-2 pl-5 text-sm ${ui.muted}`}>
              <li>Create or open the event type you want customers to book.</li>
              <li>Make sure the event is public and ready to accept bookings.</li>
              <li>Copy the public booking URL or the inline embed URL from Cal.com.</li>
              <li>Paste it here, save, then enable booking on your public page.</li>
              <li>Open your studio page and confirm the Book section appears correctly.</li>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="https://cal.com"
                target="_blank"
                rel="noreferrer"
                className={ui.btnSecondarySm}
              >
                <ExternalLink size={14} />
                Open Cal.com
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-stone-300 p-4 dark:border-stone-700">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Examples</h3>
            <div className={`mt-3 grid gap-2 text-xs ${ui.muted}`}>
              <p>
                Booking page:
                {" "}
                <span className={ui.code}>https://cal.com/your-team/discovery-call</span>
              </p>
              <p>
                Team event:
                {" "}
                <span className={ui.code}>https://cal.com/your-studio/intro-session</span>
              </p>
            </div>
            <p className={`mt-3 text-xs ${ui.muted}`}>
              If the link is saved but booking is disabled, the URL stays stored but the public booking section stays hidden.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

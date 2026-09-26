import {
  publishSalonTermsAction,
  publishStudioPrivacyNoticeAction,
  updateBookingRulesAction,
} from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { DEFAULT_SALON_TERMS_BODY, getCurrentSalonTermsText } from "@/lib/booking-setup";
import { getSelfBookingRules } from "@/lib/salon-appointments-self";
import { getLatestPrivacyNotice } from "@/lib/studio-privacy";
import { ui } from "@/lib/ui";
import type { BookingSettingsContext } from "./context";

export async function RulesSection({ ctx }: { ctx: BookingSettingsContext }) {
  const [rules, terms, privacyNotice] = await Promise.all([
    getSelfBookingRules({ studioId: ctx.studioId }),
    getCurrentSalonTermsText({ studioId: ctx.studioId }),
    getLatestPrivacyNotice({ studioId: ctx.studioId }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <section className={ui.card}>
        <h2 className={ui.h2}>Booking rules</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>Apply to customers booking online. Staff can still book any time from Appointments.</p>
        <ServerActionToastForm action={updateBookingRulesAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Minimum notice (hours)</span>
            <input
              name="min_notice_hours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              defaultValue={rules.minNoticeMinutes / 60}
              className={ui.input}
              required
            />
            <span className={`text-xs ${ui.muted}`}>Earliest a customer can book from now.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Book up to (days ahead)</span>
            <input name="max_advance_days" type="number" min={1} max={365} defaultValue={rules.maxAdvanceDays} className={ui.input} required />
            <span className={`text-xs ${ui.muted}`}>How far ahead the calendar opens.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Changes close (hours before)</span>
            <input name="change_cutoff_hours" type="number" min={0} max={168} defaultValue={rules.changeCutoffHours} className={ui.input} required />
            <span className={`text-xs ${ui.muted}`}>After this, customers must contact you to cancel or change. 0 = no limit.</span>
          </label>
          <div className="sm:col-span-3">
            <SubmitButton className={ui.btnPrimarySm} pendingText="Saving...">Save booking rules</SubmitButton>
          </div>
        </ServerActionToastForm>
      </section>

      <section id="terms" className={ui.card}>
        <h2 className={ui.h2}>Booking terms</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          {terms.versionLabel
            ? `Customers accept ${terms.versionLabel} when they book. Publishing a change creates a new version.`
            : "No booking terms yet. Customers cannot book until terms are published."}
        </p>
        <ServerActionToastForm action={publishSalonTermsAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <textarea
            name="terms_body"
            rows={10}
            defaultValue={terms.body || DEFAULT_SALON_TERMS_BODY}
            className={ui.input}
            aria-label="Booking terms"
            required
          />
          <div>
            <SubmitButton className={ui.btnPrimarySm} pendingText="Publishing...">
              {terms.versionLabel ? "Publish new version" : "Publish terms"}
            </SubmitButton>
          </div>
        </ServerActionToastForm>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Booking consent version</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          {privacyNotice?.version_label ? `Current version ${privacyNotice.version_label}` : "No consent version saved yet."}
          {" "}Customers tick this consent when they book. Not shown on the public studio page.
        </p>
        <ServerActionToastForm action={publishStudioPrivacyNoticeAction} className="mt-3">
          <input type="hidden" name="studio_id" value={ctx.studioId} />
          <button type="submit" className={ui.btnPrimarySm}>
            {privacyNotice?.version_label ? "Save consent version" : "Save privacy-v1.0"}
          </button>
        </ServerActionToastForm>
      </section>
    </div>
  );
}

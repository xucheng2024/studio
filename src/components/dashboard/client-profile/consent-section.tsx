import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { LocalTime } from "@/components/ui/LocalTime";
import { recordSalonCustomerEmailConsentAction, recordSalonCustomerPrivacyConsentAction } from "@/app/(app)/dashboard/actions";
import type { SalonCustomerConsentEvent } from "@/lib/salon-customer-sensitive";
import { ui } from "@/lib/ui";
import { latestConsent, profileListRow, SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

export function ClientConsentSection({
  scope,
  isAnonymized,
  privacyNotice,
  consents,
}: {
  scope: ClientProfileScope;
  isAnonymized: boolean;
  privacyNotice: { id: string; version_label: string } | null;
  consents: SalonCustomerConsentEvent[];
}) {
  const privacy = latestConsent(consents, "privacy_notice");
  const email = latestConsent(consents, "email_marketing");
  const emailVersion = email?.text_version || "email-marketing-v1.0";

  return (
    <section className={ui.card}>
      <h2 className={ui.h2}>Consent</h2>
      <p className={`mt-1 text-xs ${ui.muted}`}>Email marketing uses a text version. Privacy notice uses the published version label.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={privacy?.status === "granted" ? ui.badge : privacy?.status === "withdrawn" ? ui.badgeRed : ui.badgeNeutral}>
          Privacy {privacy?.status ?? "unset"}
        </span>
        <span className={email?.status === "granted" ? ui.badge : email?.status === "withdrawn" ? ui.badgeRed : ui.badgeNeutral}>
          Email {email?.status ?? "unset"}
        </span>
      </div>

      {!isAnonymized && privacyNotice?.version_label ? (
        <ServerActionToastForm action={recordSalonCustomerPrivacyConsentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScopeFields scope={scope} />
          <input type="hidden" name="consent_text_version" value={privacyNotice.version_label} />
          <input type="hidden" name="privacy_notice_version_id" value={privacyNotice.id} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Privacy notice</span>
            <select name="consent_status" className={ui.select} defaultValue={privacy?.status === "withdrawn" ? "withdrawn" : "granted"}>
              <option value="granted">Granted</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Source</span>
            <select name="consent_source" className={ui.select} defaultValue="frontdesk">
              <option value="frontdesk">Frontdesk</option>
              <option value="imported">Imported</option>
              <option value="api">API</option>
              <option value="system">System</option>
            </select>
          </label>
          <p className={`sm:col-span-2 text-xs ${ui.muted}`}>Version {privacyNotice.version_label}</p>
          <SaveBar><button type="submit" className={ui.btnPrimarySm}>Record privacy consent</button></SaveBar>
        </ServerActionToastForm>
      ) : null}

      <ServerActionToastForm action={recordSalonCustomerEmailConsentAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <ScopeFields scope={scope} />
        <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Email marketing</span>
          <select name="consent_status" className={ui.select} defaultValue={email?.status === "withdrawn" ? "withdrawn" : "granted"}>
            <option value="granted">Granted</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Source</span>
          <select name="consent_source" className={ui.select} defaultValue="frontdesk">
            <option value="frontdesk">Frontdesk</option>
            <option value="imported">Imported</option>
            <option value="api">API</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Consent text version</span>
          <input name="consent_text_version" className={ui.input} defaultValue={emailVersion} required />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={ui.label}>Evidence note</span>
          <textarea name="consent_evidence_note" className={ui.input} rows={2} />
        </label>
        <SaveBar><button type="submit" className={ui.btnPrimarySm}>Record email consent</button></SaveBar>
      </ServerActionToastForm>

      <ul className="mt-4 flex flex-col gap-2">
        {consents.map((event) => (
          <li key={event.id} className={profileListRow}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{event.consent_key} · {event.status}</span>
              <span className={`text-xs ${ui.muted}`}><LocalTime iso={event.occurred_at} /></span>
            </div>
            <p className={`mt-1 text-xs ${ui.muted}`}>source: {event.source} · text: {event.text_version} · actor role: {event.actor_role}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

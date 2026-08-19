import { AlertTriangle, ShieldAlert } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { ui } from "@/lib/ui";
import type { SalonCustomerConsentEvent, SalonCustomerPreferenceProfile } from "@/lib/salon-customer-sensitive";
import {
  updateSalonCustomerCoreProfileAction,
  updateSalonCustomerPreferencesAction,
  anonymizeSalonCustomerAction,
} from "@/app/(app)/dashboard/actions";
import { latestConsent, SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

type LocationOption = { id: string; name: string };
type EmployeeOption = { id: string; display_name: string };

export function ClientOverviewSection({
  scope,
  customerName,
  customerEmail,
  customerPhone,
  customerStatus,
  customerSource,
  preferredLocationName,
  isAnonymized,
  canAnonymize,
  notesForm,
  showPreferences,
  preferences,
  locations,
  employees,
  nextAppointmentLabel,
  pendingFollowUps,
  packageBalance,
  purchaseTotal,
  consents,
  hasHealthAlert,
  appointmentsHref,
  posHref,
  followUpQueueHref,
  approvalsHref,
}: {
  scope: ClientProfileScope;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerStatus: string;
  customerSource: string;
  preferredLocationName: string | null;
  isAnonymized: boolean;
  canAnonymize: boolean;
  notesForm: React.ReactNode;
  showPreferences: boolean;
  preferences: SalonCustomerPreferenceProfile | null;
  locations: LocationOption[];
  employees: EmployeeOption[];
  nextAppointmentLabel: string | null;
  pendingFollowUps: number;
  packageBalance: number;
  purchaseTotal: number;
  consents: SalonCustomerConsentEvent[];
  hasHealthAlert: boolean;
  appointmentsHref: string;
  posHref: string;
  followUpQueueHref: string;
  approvalsHref: string;
}) {
  const privacy = latestConsent(consents, "privacy_notice");
  const email = latestConsent(consents, "email_marketing");
  const preferredEmployees = new Set(preferences?.preferred_employee_ids ?? []);
  const preferredLocations = new Set(preferences?.preferred_location_ids ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Next appointment</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{nextAppointmentLabel ?? "None upcoming"}</p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Follow-ups</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{pendingFollowUps} pending</p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Class passes</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{packageBalance} available</p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Package spend</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">SGD {purchaseTotal.toFixed(2)}</p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Consent</p>
          <p className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">
            Privacy {privacy?.status ?? "unset"} · Email {email?.status ?? "unset"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {hasHealthAlert ? (
          <span className={ui.badgeAmber}><AlertTriangle size={12} /> Safety alert</span>
        ) : (
          <span className={ui.badge}><ShieldAlert size={12} /> No safety alert</span>
        )}
        <span className={ui.badgeNeutral}>{customerStatus}</span>
        <span className={ui.badgeNeutral}>{customerSource.replaceAll("_", " ")}</span>
        {preferredLocationName ? <span className={ui.badgeNeutral}>Preferred: {preferredLocationName}</span> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <DashboardAppLink href={appointmentsHref} className={ui.btnSecondarySm}>Calendar</DashboardAppLink>
        <DashboardAppLink href={posHref} className={ui.btnSecondarySm}>POS</DashboardAppLink>
        <DashboardAppLink href={followUpQueueHref} className={ui.btnSecondarySm}>Follow-up queue</DashboardAppLink>
        <DashboardAppLink href={approvalsHref} className={ui.btnSecondarySm}>Adjust credits</DashboardAppLink>
      </div>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={ui.h2}>Customer profile</h2>
          {isAnonymized ? <span className={ui.badgeNeutral}>Anonymized</span> : null}
        </div>
        <ServerActionToastForm action={updateSalonCustomerCoreProfileAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScopeFields scope={scope} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Full name</span>
            <input name="full_name" type="text" defaultValue={customerName} className={ui.input} placeholder="Customer name" disabled={isAnonymized} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Email</span>
            <input name="email" type="email" defaultValue={customerEmail} className={ui.input} placeholder="name@email.com" disabled={isAnonymized} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Phone</span>
            <FormPhoneField name="phone" defaultValue={customerPhone} />
          </label>
          {!isAnonymized ? (
            <SaveBar><button type="submit" className={ui.btnPrimarySm}>Save customer record</button></SaveBar>
          ) : null}
        </ServerActionToastForm>
        {notesForm}
        {canAnonymize ? (
          <div className="mt-4">
            <ToastConfirmForm
              action={anonymizeSalonCustomerAction}
              confirmMessage="This will deactivate the customer and mask name, email, phone, and health notes. It cannot be undone."
              confirmLabel="Anonymize"
              pendingLabel="Masking…"
            >
              <input type="hidden" name="studio_id" value={scope.studioId} />
              <input type="hidden" name="customer_id" value={scope.customerId} />
              {scope.locationId ? <input type="hidden" name="location_id" value={scope.locationId} /> : null}
              <button type="submit" className={ui.btnDangerSm}>Deactivate and mask</button>
            </ToastConfirmForm>
          </div>
        ) : null}
      </section>

      {showPreferences ? (
        <section className={ui.card}>
        <h2 className={ui.h2}>Preferences</h2>
        <ServerActionToastForm action={updateSalonCustomerPreferencesAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScopeFields scope={scope} />
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Preferred services</span>
            <textarea name="preferred_services" defaultValue={preferences?.preferred_services ?? ""} className={ui.input} rows={2} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className={ui.label}>Preferred employees</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {employees.length === 0 ? <p className={`text-sm ${ui.muted}`}>No active employees in this location.</p> : null}
              {employees.map((employee) => (
                <label key={employee.id} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
                  <input type="checkbox" name="preferred_employee_ids" value={employee.id} defaultChecked={preferredEmployees.has(employee.id)} className="accent-teal-600" />
                  {employee.display_name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className={ui.label}>Preferred locations</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {locations.map((location) => (
                <label key={location.id} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
                  <input type="checkbox" name="preferred_location_ids" value={location.id} defaultChecked={preferredLocations.has(location.id)} className="accent-teal-600" />
                  {location.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Preferred time slots</span>
            <input name="preferred_time_slots" defaultValue={(preferences?.preferred_time_slots ?? []).join(", ")} className={ui.input} placeholder="Weekday AM, Weekend PM" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Communication language</span>
            <input name="communication_language" defaultValue={preferences?.communication_language ?? ""} className={ui.input} placeholder="English / 中文" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Contact preference</span>
            <input name="contact_preference" defaultValue={preferences?.contact_preference ?? ""} className={ui.input} placeholder="Email / Call / Frontdesk" />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Product preferences</span>
            <textarea name="product_preferences" defaultValue={preferences?.product_preferences ?? ""} className={ui.input} rows={2} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Environment preferences</span>
            <textarea name="environment_preferences" defaultValue={preferences?.environment_preferences ?? ""} className={ui.input} rows={2} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Service notes</span>
            <textarea name="preference_notes" defaultValue={preferences?.notes ?? ""} className={ui.input} rows={3} />
          </label>
          <SaveBar>
            <div className={ui.mobileActionBar}>
              <button type="submit" className={ui.btnPrimarySm}>Save preferences</button>
            </div>
          </SaveBar>
        </ServerActionToastForm>
      </section>
      ) : null}
    </div>
  );
}

import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ToastConfirmForm } from "@/components/ToastConfirmForm";
import { LocalDate } from "@/components/ui/LocalDate";
import {
  anonymizeSalonCustomerAction,
  markAppointmentRetentionReviewedAction,
  publishStudioPrivacyNoticeAction,
  updateStudioRetentionSettingsAction,
} from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { studioPrivacyPath } from "@/lib/public-paths";
import {
  DEFAULT_RETENTION_DAYS,
  getLatestPrivacyNotice,
  getStudioPrivacySettings,
  listRetentionQueue,
  studioProcessorCatalog,
} from "@/lib/studio-privacy";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function DashboardPrivacySettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId } = await getDashboardScopeForRoles({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: null,
  }, ["owner", "manager"]);
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const [settings, notice, queue] = await Promise.all([
    getStudioPrivacySettings({ studioId }),
    getLatestPrivacyNotice({ studioId }),
    listRetentionQueue({ userId: user.id, studioId }),
  ]);
  if (!settings) return <p className={ui.muted}>Studio not found.</p>;

  const processors = studioProcessorCatalog({
    hitpayEnabled: Boolean(settings.hitpay_enabled),
    resendEnabled: Boolean(settings.resend_enabled),
  });
  const publicHref = settings.public_slug ? studioPrivacyPath(settings.public_slug) : null;
  const customerDays = settings.customer_retention_days ?? DEFAULT_RETENTION_DAYS;
  const appointmentDays = settings.appointment_retention_days ?? DEFAULT_RETENTION_DAYS;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId)} className={`${ui.btnSecondarySm} mb-3`}>
          Back to settings
        </DashboardAppLink>
        <h1 className={ui.h1}>Privacy & data</h1>
        <p className={`mt-1 ${ui.muted}`}>
          Public notice version, retention rules, and processors used to fill PDPA forms. This is system evidence, not legal advice.
        </p>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>Privacy notice</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          {notice?.version_label ? `Current version ${notice.version_label}` : "No version published yet."}
          {publicHref ? <> · <a href={publicHref} className={ui.link} target="_blank" rel="noreferrer">Open public page</a></> : null}
        </p>
        <ServerActionToastForm action={publishStudioPrivacyNoticeAction} className="mt-3">
          <input type="hidden" name="studio_id" value={studioId} />
          <button type="submit" className={ui.btnPrimarySm}>
            {notice?.version_label ? "Publish latest template" : "Publish privacy-v1.0"}
          </button>
        </ServerActionToastForm>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Retention</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>Rules only. Staff review the queue and anonymize or mark reviewed. No automatic delete.</p>
        <ServerActionToastForm action={updateStudioRetentionSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={studioId} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Customer records (days)</span>
            <input name="customer_retention_days" type="number" min={1} max={36500} defaultValue={customerDays} className={ui.input} required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Appointments (days)</span>
            <input name="appointment_retention_days" type="number" min={1} max={36500} defaultValue={appointmentDays} className={ui.input} required />
          </label>
          <div className="sm:col-span-2"><button type="submit" className={ui.btnPrimarySm}>Save retention rules</button></div>
        </ServerActionToastForm>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Due for review</h2>
        {!queue.ok ? (
          <p className={`mt-2 text-sm ${ui.muted}`}>Could not load the retention queue.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h3 className={ui.h3}>Customers older than {queue.customerDays} days</h3>
              {queue.customers.length === 0 ? (
                <p className={`mt-2 text-sm ${ui.muted}`}>None due.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {queue.customers.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-100 px-3 py-2 dark:border-stone-800">
                      <div>
                        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{row.full_name}</p>
                        <p className={`text-xs ${ui.muted}`}>Last activity <LocalDate iso={row.last_activity_at} /> · {row.status}</p>
                      </div>
                      <ToastConfirmForm
                        action={anonymizeSalonCustomerAction}
                        confirmMessage="Mask this customer now?"
                        confirmLabel="Anonymize"
                        pendingLabel="Masking…"
                      >
                        <input type="hidden" name="studio_id" value={studioId} />
                        <input type="hidden" name="customer_id" value={row.id} />
                        <button type="submit" className={ui.btnDangerSm}>Anonymize</button>
                      </ToastConfirmForm>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className={ui.h3}>Appointments older than {queue.appointmentDays} days</h3>
              {queue.appointments.length === 0 ? (
                <p className={`mt-2 text-sm ${ui.muted}`}>None due.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {queue.appointments.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-100 px-3 py-2 dark:border-stone-800">
                      <div>
                        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{row.service_title_snapshot ?? "Appointment"}</p>
                        <p className={`text-xs ${ui.muted}`}>{row.customer_name} · <LocalDate iso={row.starts_at} /> · {row.status}</p>
                      </div>
                      <ServerActionToastForm action={markAppointmentRetentionReviewedAction}>
                        <input type="hidden" name="studio_id" value={studioId} />
                        <input type="hidden" name="appointment_id" value={row.id} />
                        <button type="submit" className={ui.btnSecondarySm}>Mark reviewed</button>
                      </ServerActionToastForm>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Processors</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>Use this list when filling a Personal Data Protection form.</p>
        <ul className="mt-3 flex flex-col gap-3">
          {processors.map((processor) => (
            <li key={processor.key} className="rounded-xl border border-stone-100 px-3 py-3 dark:border-stone-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{processor.name}</p>
                <span className={processor.enabled ? ui.badge : ui.badgeNeutral}>
                  {processor.enabled ? "In use" : "Not enabled"}
                </span>
              </div>
              <p className={`mt-1 text-sm ${ui.muted}`}>{processor.purpose}</p>
              <p className={`text-xs ${ui.muted}`}>{processor.dataInvolved}</p>
              <a href={processor.siteUrl} className={`${ui.link} mt-1 text-xs`} target="_blank" rel="noreferrer">{processor.siteUrl}</a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

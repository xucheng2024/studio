import { AlertTriangle, ShieldAlert } from "lucide-react";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { updateSalonCustomerHealthProfileAction } from "@/app/(app)/dashboard/actions";
import { toLocalDateTimeInputValue } from "@/lib/date";
import type { SalonCustomerHealthProfile, SalonCustomerSafetyAlertSummary } from "@/lib/salon-customer-sensitive";
import { ui } from "@/lib/ui";
import { SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

export function ClientHealthSection({
  scope,
  safety,
  health,
}: {
  scope: ClientProfileScope;
  safety: SalonCustomerSafetyAlertSummary;
  health: SalonCustomerHealthProfile | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className={`${ui.card} border-amber-200/60 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/25`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 text-amber-600 dark:text-amber-400" size={16} />
          <div>
            <h2 className={`${ui.h2} text-amber-900 dark:text-amber-100`}>Sensitive information</h2>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
              Health & safety data is sensitive. Access is role-scoped, audited, and must only be used for service safety.
            </p>
          </div>
        </div>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Health & safety</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {safety.hasHealthAlert ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              <AlertTriangle size={12} />
              Safety alert exists
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
              <ShieldAlert size={12} />
              No active safety alert
            </span>
          )}
        </div>
        <ServerActionToastForm action={updateSalonCustomerHealthProfileAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <ScopeFields scope={scope} />
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Allergies</span><textarea name="allergies" defaultValue={health?.allergies ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Reaction ingredients</span><textarea name="reaction_ingredients" defaultValue={health?.reaction_ingredients ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Reaction products</span><textarea name="reaction_products" defaultValue={health?.reaction_products ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Declared health conditions</span><textarea name="declared_health_conditions" defaultValue={health?.declared_health_conditions ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Pregnancy / service-affecting conditions</span><textarea name="service_affecting_conditions" defaultValue={health?.service_affecting_conditions ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Contraindications</span><textarea name="contraindications" defaultValue={health?.contraindications ?? ""} className={ui.input} rows={2} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test required</span><select name="patch_test_required" className={ui.select} defaultValue={health?.patch_test_required ? "true" : "false"}><option value="false">No</option><option value="true">Yes</option></select></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test date</span><input name="patch_test_date" type="date" className={ui.input} defaultValue={health?.patch_test_date ?? ""} /></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Patch test result</span><select name="patch_test_result" className={ui.select} defaultValue={health?.patch_test_result ?? ""}><option value="">Select</option><option value="pending">Pending</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="not_required">Not required</option></select></label>
          <label className="flex flex-col gap-1.5"><span className={ui.label}>Last confirmed</span><input name="last_confirmed_at" type="datetime-local" className={ui.input} defaultValue={toLocalDateTimeInputValue(health?.last_confirmed_at ?? new Date().toISOString())} /></label>
          <SaveBar>
            <div className={ui.mobileActionBar}>
              <button type="submit" className={ui.btnPrimarySm}>Save health & safety</button>
            </div>
          </SaveBar>
        </ServerActionToastForm>
      </section>
    </div>
  );
}

import { Lock } from "lucide-react";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { LocalTime } from "@/components/ui/LocalTime";
import { completeSalonCustomerDataRequestAction, createSalonCustomerDataRequestAction } from "@/app/(app)/dashboard/actions";
import type { SalonCustomerAccessAuditEntry, SalonCustomerDataRequest } from "@/lib/salon-customer-sensitive";
import { ui } from "@/lib/ui";
import { profileListRow, SaveBar, ScopeFields, type ClientProfileScope } from "./shared";

export function ClientAuditSection({
  scope,
  isAnonymized,
  customerName,
  customerEmail,
  customerPhone,
  dataRequests,
  accessAudits,
  canViewSensitiveAudit,
}: {
  scope: ClientProfileScope;
  isAnonymized: boolean;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  dataRequests: SalonCustomerDataRequest[];
  accessAudits: SalonCustomerAccessAuditEntry[];
  canViewSensitiveAudit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className={ui.card}>
        <h2 className={ui.h2}>Access / correction requests</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>Record a customer request to see or correct their data, then close it with a note.</p>
        {!isAnonymized ? (
          <ServerActionToastForm action={createSalonCustomerDataRequestAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <ScopeFields scope={scope} />
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Request type</span>
              <select name="request_type" className={ui.select} defaultValue="access">
                <option value="access">View my data</option>
                <option value="correction">Correct my data</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={ui.label}>Customer note</span>
              <textarea name="customer_note" className={ui.input} rows={2} placeholder="What the customer asked for" />
            </label>
            <SaveBar><button type="submit" className={ui.btnPrimarySm}>Record request</button></SaveBar>
          </ServerActionToastForm>
        ) : null}
        <ul className="mt-4 flex flex-col gap-2">
          {dataRequests.map((request) => (
            <li key={request.id} className={profileListRow}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{request.request_type} · {request.status}</span>
                <span className={`text-xs ${ui.muted}`}><LocalTime iso={request.requested_at} /></span>
              </div>
              {request.customer_note ? <p className={`mt-1 text-xs ${ui.muted}`}>{request.customer_note}</p> : null}
              {request.status === "open" ? (
                <ServerActionToastForm action={completeSalonCustomerDataRequestAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <ScopeFields scope={scope} />
                  <input type="hidden" name="request_id" value={request.id} />
                  {request.request_type === "correction" ? (
                    <>
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>Corrected name</span><input name="full_name" className={ui.input} defaultValue={customerName} /></label>
                      <label className="flex flex-col gap-1.5"><span className={ui.label}>Corrected email</span><input name="email" className={ui.input} defaultValue={customerEmail} /></label>
                      <label className="flex flex-col gap-1.5 sm:col-span-2"><span className={ui.label}>Corrected phone</span><FormPhoneField name="phone" defaultValue={customerPhone} /></label>
                    </>
                  ) : null}
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Close as</span>
                    <select name="request_status" className={ui.select} defaultValue="completed">
                      <option value="completed">Completed</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className={ui.label}>Staff note</span>
                    <textarea name="staff_note" className={ui.input} rows={2} required placeholder={request.request_type === "access" ? "Shown the profile to the customer" : "Corrected fields"} />
                  </label>
                  <SaveBar><button type="submit" className={ui.btnPrimarySm}>Close request</button></SaveBar>
                </ServerActionToastForm>
              ) : (
                <p className={`mt-1 text-xs ${ui.muted}`}>{request.staff_note ?? "Closed"}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={ui.card}>
        <div className="flex items-center gap-2"><Lock size={15} className="text-stone-500" /><h2 className={ui.h2}>Sensitive access log</h2></div>
        {canViewSensitiveAudit ? (
          <ul className="mt-3 flex flex-col gap-2">
            {accessAudits.map((audit) => (
              <li key={audit.id} className={profileListRow}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{audit.action}</span>
                  <span className={`text-xs ${ui.muted}`}><LocalTime iso={audit.created_at} /></span>
                </div>
                <p className={`mt-1 text-xs ${ui.muted}`}>actor role: {audit.actor_role}{audit.location_id ? ` · location: ${audit.location_id}` : ""}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 text-sm ${ui.muted}`}>You are authorised to view sensitive data, but not the full access audit trail.</p>
        )}
      </section>
    </div>
  );
}

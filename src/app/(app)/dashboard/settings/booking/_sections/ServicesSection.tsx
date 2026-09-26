import {
  copyServiceBookingSetupAction,
  setServiceEligibleEmployeesAction,
  setServiceOnlineBookableAction,
  setServicePublishScopeAction,
  setServiceResourceRequirementsAction,
  updateServiceAvailabilityDefaultsAction,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import {
  DurationPresetField,
  EligibleStaffPicker,
  ServiceLocationScopeFields,
} from "@/components/dashboard/ServiceBookingSetupFields";
import { SubmitButton } from "@/components/SubmitButton";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import type { BookingSettingsContext } from "./context";

export async function ServicesSection({ ctx }: { ctx: BookingSettingsContext }) {
  const admin = createAdminClient();
  const [{ data: services }, { data: employees }, { data: serviceEmployees }, { data: resourceRequirements }, { data: locations }, { data: serviceLocations }] = await Promise.all([
    admin
      .from("studio_services")
      .select("id, title, is_active, online_bookable, default_duration_minutes, default_prep_minutes, default_buffer_minutes, location_publish_scope")
      .eq("studio_id", ctx.studioId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("employees")
      .select("id, display_name, employment_status")
      .eq("studio_id", ctx.studioId)
      .eq("is_active", true)
      .in("employment_status", ["active", "probation"])
      .order("display_name"),
    admin
      .from("service_employees")
      .select("service_id, employee_id, is_active")
      .eq("studio_id", ctx.studioId),
    admin
      .from("service_resource_requirements")
      .select("service_id, resource_type, required_quantity")
      .eq("studio_id", ctx.studioId),
    admin
      .from("locations")
      .select("id, name")
      .eq("studio_id", ctx.studioId)
      .eq("is_active", true)
      .order("name"),
    admin
      .from("service_locations")
      .select("service_id, location_id, is_enabled")
      .eq("studio_id", ctx.studioId),
  ]);

  const eligibleEmployeeMap = new Map<string, Set<string>>();
  for (const row of serviceEmployees ?? []) {
    if (!row.is_active) continue;
    const existing = eligibleEmployeeMap.get(row.service_id) ?? new Set<string>();
    existing.add(row.employee_id);
    eligibleEmployeeMap.set(row.service_id, existing);
  }
  const requirementMap = new Map<string, Partial<Record<"room" | "bed" | "equipment" | "other", number>>>();
  for (const row of resourceRequirements ?? []) {
    const existing = requirementMap.get(row.service_id) ?? {};
    existing[row.resource_type as "room" | "bed" | "equipment" | "other"] = row.required_quantity;
    requirementMap.set(row.service_id, existing);
  }
  const enabledLocationMap = new Map<string, Set<string>>();
  for (const row of serviceLocations ?? []) {
    if (!row.is_enabled) continue;
    const existing = enabledLocationMap.get(row.service_id) ?? new Set<string>();
    existing.add(row.location_id);
    enabledLocationMap.set(row.service_id, existing);
  }
  const locationList = locations ?? [];
  const locationNameById = new Map(locationList.map((location) => [location.id, location.name]));
  const candidateEmployeeIds = (employees ?? []).map((employee) => employee.id).join(",");

  if (!(services ?? []).length) {
    return (
      <p className={ui.muted}>
        No active services yet.{" "}
        <DashboardAppLink href={ctx.selectedStudioId ? `/dashboard/services?studio_id=${ctx.selectedStudioId}` : "/dashboard/services"} className={ui.link}>
          Add a service
        </DashboardAppLink>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={`${ui.card} overflow-x-auto`}>
        <p className={`text-sm ${ui.muted}`}>
          Name, price and description live on the Services page. Everything that decides when a service can be booked is here.
        </p>
        <table className="mt-3 w-full min-w-[32rem] text-left text-sm">
          <thead className={`text-xs ${ui.muted}`}>
            <tr>
              <th className="py-1.5 pr-3 font-medium">Service</th>
              <th className="py-1.5 pr-3 font-medium">Online</th>
              <th className="py-1.5 pr-3 font-medium">Duration</th>
              <th className="py-1.5 pr-3 font-medium">Staff</th>
              <th className="py-1.5 font-medium">Locations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {(services ?? []).map((svc) => {
              const staffCount = eligibleEmployeeMap.get(svc.id)?.size ?? 0;
              const locationNames = [...(enabledLocationMap.get(svc.id) ?? [])].map((id) => locationNameById.get(id)).filter(Boolean);
              return (
                <tr key={svc.id}>
                  <td className="py-2 pr-3">
                    <a href={`#svc-${svc.id}`} className={ui.link}>{svc.title}</a>
                  </td>
                  <td className="py-2 pr-3">{svc.online_bookable === false ? <span className={ui.badgeAmber}>Off</span> : <span className={ui.badge}>On</span>}</td>
                  <td className="py-2 pr-3 tabular-nums">{Number(svc.default_duration_minutes ?? 60)} min</td>
                  <td className={`py-2 pr-3 ${staffCount ? "" : "text-amber-700 dark:text-amber-300"}`}>{staffCount || "None"}</td>
                  <td className={`py-2 ${locationNames.length ? "" : "text-amber-700 dark:text-amber-300"}`}>
                    {locationNames.length === locationList.length && locationList.length > 1 ? "All" : locationNames.join(", ") || "None"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(services ?? []).map((svc) => (
        <details key={svc.id} id={`svc-${svc.id}`} className={`chevron ${ui.card}`}>
          <summary className="flex cursor-pointer items-center justify-between gap-3">
            <h3 className="break-all text-base font-semibold text-stone-900 dark:text-stone-100">{svc.title}</h3>
            {svc.online_bookable === false ? <span className={ui.badgeAmber}>Online off</span> : null}
          </summary>
          <ServerActionToastForm action={setServiceOnlineBookableAction} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
            <input type="hidden" name="studio_id" value={ctx.studioId} />
            <input type="hidden" name="service_id" value={svc.id} />
            <input type="hidden" name="online_bookable" value={svc.online_bookable === false ? "true" : "false"} />
            <span className="text-sm text-stone-900 dark:text-stone-100">
              {svc.online_bookable === false
                ? "Customers cannot book this service online. Staff can still book it."
                : "Customers can book this service online."}
            </span>
            <SubmitButton className={ui.btnSecondarySm} pendingText="Saving...">
              {svc.online_bookable === false ? "Turn online booking on" : "Turn online booking off"}
            </SubmitButton>
          </ServerActionToastForm>
          <div className="mt-3 grid gap-3">
            <p className={`text-xs ${ui.muted}`}>Each block has its own Save.</p>
            {(services ?? []).filter((other) => other.id !== svc.id).length > 0 ? (
              <ServerActionToastForm action={copyServiceBookingSetupAction} className="flex flex-col gap-3 rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80 sm:flex-row sm:items-end">
                <input type="hidden" name="studio_id" value={ctx.studioId} />
                <input type="hidden" name="service_id" value={svc.id} />
                <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className={ui.label}>Copy from another service</span>
                  <select name="source_service_id" required className={ui.select} defaultValue="">
                    <option value="" disabled>
                      Choose a service
                    </option>
                    {(services ?? [])
                      .filter((other) => other.id !== svc.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.title}
                        </option>
                      ))}
                  </select>
                </label>
                <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Copying...">
                  Copy booking setup
                </SubmitButton>
              </ServerActionToastForm>
            ) : null}

            <ServerActionToastForm action={updateServiceAvailabilityDefaultsAction} className="grid gap-3 rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80 sm:grid-cols-3">
              <input type="hidden" name="studio_id" value={ctx.studioId} />
              <input type="hidden" name="service_id" value={svc.id} />
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100 sm:col-span-3">Appointment defaults</p>
              <DurationPresetField
                name="default_duration_minutes"
                defaultValue={Number((svc as { default_duration_minutes?: number }).default_duration_minutes ?? 60)}
              />
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Prep (mins)</span>
                <input
                  name="default_prep_minutes"
                  type="number"
                  min="0"
                  defaultValue={Number((svc as { default_prep_minutes?: number }).default_prep_minutes ?? 0)}
                  className={ui.input}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Cleanup buffer (mins)</span>
                <input
                  name="default_buffer_minutes"
                  type="number"
                  min="0"
                  defaultValue={Number((svc as { default_buffer_minutes?: number }).default_buffer_minutes ?? 0)}
                  className={ui.input}
                />
              </label>
              <div className="sm:col-span-3">
                <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Saving...">
                  Save appointment defaults
                </SubmitButton>
              </div>
            </ServerActionToastForm>

            <ServerActionToastForm action={setServiceEligibleEmployeesAction} className="rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
              <input type="hidden" name="studio_id" value={ctx.studioId} />
              <input type="hidden" name="service_id" value={svc.id} />
              <input type="hidden" name="candidate_employee_ids" value={candidateEmployeeIds} />
              <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Eligible staff</p>
              {(employees ?? []).length === 0 ? (
                <p className={`mt-2 text-xs ${ui.muted}`}>No active employees available yet.</p>
              ) : (
                <div className="mt-2">
                  <EligibleStaffPicker
                    employees={employees ?? []}
                    selectedIds={[...(eligibleEmployeeMap.get(svc.id) ?? [])]}
                  />
                </div>
              )}
              <div className="mt-3">
                <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Saving...">
                  Save eligible staff
                </SubmitButton>
              </div>
            </ServerActionToastForm>

            {locationList.length > 1 ? (
              <ServerActionToastForm action={setServicePublishScopeAction} className="rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
                <input type="hidden" name="studio_id" value={ctx.studioId} />
                <input type="hidden" name="service_id" value={svc.id} />
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Offered at (price &amp; details apply everywhere it&apos;s offered)</p>
                <div className="mt-2">
                  <ServiceLocationScopeFields
                    locations={locationList}
                    defaultScope={
                      (svc as { location_publish_scope?: "all_locations" | "selected_locations" }).location_publish_scope === "selected_locations"
                        ? "selected_locations"
                        : "all_locations"
                    }
                    enabledLocationIds={[...(enabledLocationMap.get(svc.id) ?? [])]}
                  />
                </div>
                <div className="mt-3">
                  <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Saving...">
                    Save locations
                  </SubmitButton>
                </div>
              </ServerActionToastForm>
            ) : null}

            <details className="chevron rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
              <summary className="cursor-pointer text-sm font-medium text-stone-900 dark:text-stone-100">
                Required resource types
              </summary>
              <ServerActionToastForm action={setServiceResourceRequirementsAction} className="mt-3 grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="studio_id" value={ctx.studioId} />
                <input type="hidden" name="service_id" value={svc.id} />
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Rooms</span>
                  <input
                    name="room_qty"
                    type="number"
                    min="0"
                    defaultValue={requirementMap.get(svc.id)?.room ?? 0}
                    className={ui.input}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Beds</span>
                  <input
                    name="bed_qty"
                    type="number"
                    min="0"
                    defaultValue={requirementMap.get(svc.id)?.bed ?? 0}
                    className={ui.input}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Equipment</span>
                  <input
                    name="equipment_qty"
                    type="number"
                    min="0"
                    defaultValue={requirementMap.get(svc.id)?.equipment ?? 0}
                    className={ui.input}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Other</span>
                  <input
                    name="other_qty"
                    type="number"
                    min="0"
                    defaultValue={requirementMap.get(svc.id)?.other ?? 0}
                    className={ui.input}
                  />
                </label>
                <div className="sm:col-span-4">
                  <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-fit`} pendingText="Saving...">
                    Save requirements
                  </SubmitButton>
                </div>
              </ServerActionToastForm>
            </details>
          </div>

        </details>
      ))}
    </div>
  );
}

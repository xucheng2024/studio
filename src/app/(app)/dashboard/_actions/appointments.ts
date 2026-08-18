"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { localISODate, parseDatetimeLocalAsSgt } from "@/lib/date";
import { mapPosMutationMessage } from "@/lib/pos-error-message";
import { createPosSaleDraft, upsertPosSaleItem } from "@/lib/pos-sales";
import {
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  transitionAppointmentStatus,
  type AppointmentConflictCode,
} from "@/lib/salon-appointments";
import { listSelfBookableSlots } from "@/lib/salon-appointments-self";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

function getIdempotencyKey(formData: FormData, fieldName = "idempotency_key") {
  const raw = String(formData.get(fieldName) ?? "").trim();
  return raw || crypto.randomUUID();
}

function parseResourceIds(raw: string) {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function mapAppointmentError(code: AppointmentConflictCode, fallback: string) {
  switch (code) {
    case "slot_conflict":
      return "Selected time conflicts with another appointment.";
    case "resource_conflict":
      return "Selected resource is already occupied for this time.";
    case "scope_violation":
    case "forbidden":
      return "You do not have permission for this appointment scope.";
    case "studio_suspended":
      return "Studio is suspended. Resume contract before updating appointments.";
    case "not_found":
      return "Appointment not found or inaccessible.";
    case "idempotency_in_progress":
      return "Same request is already being processed. Please retry shortly.";
    case "idempotency_conflict":
      return "Repeated request payload mismatch. Refresh and submit again.";
    case "idempotency_stale_claim":
      return "Request token expired. Please retry the action.";
    default:
      return fallback;
  }
}

async function resolveResourceIds(params: {
  studioId: string;
  locationId: string;
  serviceId: string;
  employeeId: string;
  startsAt: Date;
  explicitIds: string[];
}) {
  if (params.explicitIds.length > 0) return params.explicitIds;

  const slotResult = await listSelfBookableSlots({
    studioId: params.studioId,
    locationId: params.locationId,
    serviceId: params.serviceId,
    dateYmd: localISODate(params.startsAt),
    nowIso: new Date(params.startsAt.getTime() - 1000).toISOString(),
  });

  if (!slotResult.ok) {
    console.log("appointment resource auto-pick skipped", {
      code: slotResult.code,
      message: slotResult.message,
      studioId: params.studioId,
      locationId: params.locationId,
      serviceId: params.serviceId,
      employeeId: params.employeeId,
    });
    return undefined;
  }

  const startMs = params.startsAt.getTime();
  const match = slotResult.payload.slots.find(
    (slot) => slot.employeeId === params.employeeId && new Date(slot.startsAtIso).getTime() === startMs,
  );
  if (!match) {
    console.log("appointment resource auto-pick no matching slot", {
      studioId: params.studioId,
      locationId: params.locationId,
      serviceId: params.serviceId,
      employeeId: params.employeeId,
      startsAt: params.startsAt.toISOString(),
      slotCount: slotResult.payload.slots.length,
    });
    return undefined;
  }
  return match.resourceIds.length ? match.resourceIds : undefined;
}

export async function createSalonAppointmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const salonCustomerId = String(formData.get("salon_customer_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const startsAtRaw = String(formData.get("starts_at") ?? "").trim();
  const startsAt = parseDatetimeLocalAsSgt(startsAtRaw);
  const resourceIds = parseResourceIds(String(formData.get("resource_ids") ?? ""));
  const internalNote = String(formData.get("internal_note") ?? "").trim() || null;

  if (!studioId || !locationId || !salonCustomerId || !serviceId || !employeeId || !startsAt) {
    return err("Please complete required fields: location, customer, service, employee, starts at.");
  }

  const { user } = await requireUser();
  const resolvedResourceIds = await resolveResourceIds({
    studioId,
    locationId,
    serviceId,
    employeeId,
    startsAt,
    explicitIds: resourceIds,
  });
  const idempotencyKey = getIdempotencyKey(formData);
  const result = await createAppointment({
    userId: user.id,
    studioId,
    locationId,
    salonCustomerId,
    serviceId,
    employeeId,
    startsAtIso: startsAt.toISOString(),
    resourceIds: resolvedResourceIds,
    internalNote,
    idempotencyKey,
  });

  if (!result.ok) {
    console.log("createSalonAppointmentAction failed", {
      code: result.code,
      message: result.message,
      studioId,
      locationId,
      serviceId,
      employeeId,
    });
    return err(mapAppointmentError(result.code, result.message || "Could not create appointment."));
  }

  if (result.payload.status === "pending") {
    const confirm = await transitionAppointmentStatus({
      userId: user.id,
      studioId,
      appointmentId: result.payload.appointmentId,
      toStatus: "confirmed",
      reason: "staff_created",
      idempotencyKey: `apt-staff-confirm:${result.payload.appointmentId}:${idempotencyKey}`,
    });
    if (!confirm.ok) {
      console.log("staff auto-confirm failed after create", {
        code: confirm.code,
        message: confirm.message,
        appointmentId: result.payload.appointmentId,
      });
      return err(mapAppointmentError(confirm.code, confirm.message || "Appointment created but could not confirm."));
    }
  }

  revalidatePath("/dashboard/appointments");
  return ok("Appointment created.");
}

export async function rescheduleSalonAppointmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  const newStartsAtRaw = String(formData.get("new_starts_at") ?? "").trim();
  const newStartsAt = parseDatetimeLocalAsSgt(newStartsAtRaw);
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const newLocationId = String(formData.get("new_location_id") ?? "").trim() || null;
  const newServiceId = String(formData.get("new_service_id") ?? "").trim() || null;
  const newEmployeeId = String(formData.get("new_employee_id") ?? "").trim() || null;
  const newResourceIds = parseResourceIds(String(formData.get("new_resource_ids") ?? ""));

  if (!studioId || !appointmentId || !newStartsAt) {
    return err("Please complete required fields: appointment and new start time.");
  }

  const { user } = await requireUser();
  let resolvedResourceIds: string[] | undefined = newResourceIds.length ? newResourceIds : undefined;
  if (!resolvedResourceIds && newLocationId && newServiceId && newEmployeeId) {
    resolvedResourceIds = await resolveResourceIds({
      studioId,
      locationId: newLocationId,
      serviceId: newServiceId,
      employeeId: newEmployeeId,
      startsAt: newStartsAt,
      explicitIds: [],
    });
  }

  const result = await rescheduleAppointment({
    userId: user.id,
    studioId,
    appointmentId,
    newStartsAtIso: newStartsAt.toISOString(),
    newLocationId,
    newServiceId,
    newEmployeeId,
    newResourceIds: resolvedResourceIds,
    reason,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    console.log("rescheduleSalonAppointmentAction failed", {
      code: result.code,
      message: result.message,
      appointmentId,
    });
    return err(mapAppointmentError(result.code, result.message || "Could not reschedule appointment."));
  }

  revalidatePath("/dashboard/appointments");
  return ok("Appointment rescheduled.");
}

export async function cancelSalonAppointmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!studioId || !appointmentId || !reason) {
    return err("Cancellation reason is required.");
  }

  const { user } = await requireUser();
  const result = await cancelAppointment({
    userId: user.id,
    studioId,
    appointmentId,
    reason,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    return err(mapAppointmentError(result.code, result.message || "Could not cancel appointment."));
  }

  revalidatePath("/dashboard/appointments");
  return ok(result.payload.alreadyCancelled ? "Appointment already cancelled." : "Appointment cancelled.");
}

export async function transitionSalonAppointmentStatusAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  const toStatus = String(formData.get("to_status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!studioId || !appointmentId || !toStatus) {
    return err("Missing required status transition fields.");
  }

  const { user } = await requireUser();
  const result = await transitionAppointmentStatus({
    userId: user.id,
    studioId,
    appointmentId,
    toStatus: toStatus as "confirmed" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show",
    reason,
    idempotencyKey: getIdempotencyKey(formData),
  });

  if (!result.ok) {
    return err(mapAppointmentError(result.code, result.message || "Could not change appointment status."));
  }

  revalidatePath("/dashboard/appointments");
  if (result.payload.alreadyInTarget) {
    return ok(`Appointment already ${result.payload.toStatus}.`);
  }
  return ok(`Appointment moved to ${result.payload.toStatus.replaceAll("_", " ")}.`);
}

export async function chargeSalonAppointmentAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const appointmentId = String(formData.get("appointment_id") ?? "").trim();
  const salonCustomerId = String(formData.get("salon_customer_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const itemName = String(formData.get("item_name") ?? "").trim();
  const currency = String(formData.get("currency") ?? "SGD").trim() || "SGD";
  const unitPriceRaw = String(formData.get("unit_price") ?? "").trim();
  const unitPrice = Number(unitPriceRaw);

  if (!studioId || !locationId || !appointmentId || !serviceId) {
    return err("Missing appointment details for POS charge.");
  }

  const { user } = await requireUser();
  const draft = await createPosSaleDraft({
    userId: user.id,
    studioId,
    locationId,
    salonCustomerId: salonCustomerId || null,
    note: `Appointment ${appointmentId.slice(0, 8)}`,
    idempotencyKey: `apt-charge:${appointmentId}`,
  });

  if (!draft.ok) {
    console.log("chargeSalonAppointmentAction draft failed", {
      code: draft.code,
      message: draft.message,
      appointmentId,
    });
    return err(mapPosMutationMessage(draft.code, draft.message || "Could not create POS draft."));
  }

  const item = await upsertPosSaleItem({
    userId: user.id,
    studioId,
    saleId: draft.payload.sale_id,
    lineNumber: 1,
    itemType: "service",
    serviceId,
    salonAppointmentId: appointmentId,
    employeeId: employeeId || null,
    itemNameSnapshot: itemName || "Service",
    itemCurrencySnapshot: currency,
    quantity: 1,
    unitPriceAmount: Number.isFinite(unitPrice) ? unitPrice : 0,
    idempotencyKey: `apt-charge-item:${appointmentId}`,
  });

  if (!item.ok) {
    console.log("chargeSalonAppointmentAction item failed", {
      code: item.code,
      message: item.message,
      appointmentId,
      saleId: draft.payload.sale_id,
    });
    return err(mapPosMutationMessage(item.code, item.message || "Could not add appointment to POS."));
  }

  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard/pos");
  const query = new URLSearchParams({ studio_id: studioId, location_id: locationId, sale_id: draft.payload.sale_id });
  redirect(`/dashboard/pos?${query.toString()}`);
}

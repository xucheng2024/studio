"use server";

import { revalidateDashboardContent } from "@/lib/revalidatePublic";
import {
  setServiceEmployeeEligibilities,
  setServiceResourceRequirements,
  updateStudioServiceAvailabilityDefaults,
  type ResourceType,
} from "@/lib/service-availability";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

const RESOURCE_TYPES: ResourceType[] = ["room", "bed", "equipment", "other"];

function parseNonNegativeInt(raw: FormDataEntryValue | null): number | null {
  if (raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function parseQuantityInput(raw: FormDataEntryValue | null): {
  ok: true;
  value: number | null;
} | {
  ok: false;
  message: string;
} {
  if (raw == null) return { ok: true, value: null };
  const text = String(raw).trim();
  if (!text) return { ok: true, value: null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: "Quantity must be a valid number." };
  }
  if (!Number.isInteger(parsed)) {
    return { ok: false, message: "Quantity must be a whole number." };
  }
  if (parsed < 0) {
    return { ok: false, message: "Quantity cannot be negative." };
  }
  if (parsed === 0) return { ok: true, value: null };
  return { ok: true, value: parsed };
}

export async function updateServiceAvailabilityDefaultsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!studioId || !serviceId) return err("Please fill the required fields.");

  const duration = parseNonNegativeInt(formData.get("default_duration_minutes"));
  const prep = parseNonNegativeInt(formData.get("default_prep_minutes"));
  const buffer = parseNonNegativeInt(formData.get("default_buffer_minutes"));
  if (duration == null || duration <= 0) return err("Standard duration must be a positive number of minutes.");
  if (prep == null) return err("Prep time must be zero or a positive number of minutes.");
  if (buffer == null) return err("Cleanup buffer must be zero or a positive number of minutes.");

  const { user } = await requireUser();
  const result = await updateStudioServiceAvailabilityDefaults({
    userId: user.id,
    studioId,
    serviceId,
    defaultDurationMinutes: duration,
    defaultPrepMinutes: prep,
    defaultBufferMinutes: buffer,
  });
  if (!result.ok) return err(result.message ?? "Could not save availability defaults.");

  revalidateDashboardContent("services");
  return ok("Availability defaults saved.");
}

export async function setServiceEligibleEmployeesAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!studioId || !serviceId) return err("Please fill the required fields.");

  const candidateIds = String(formData.get("candidate_employee_ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const checkedIds = new Set(formData.getAll("employee_ids").map((value) => String(value)));
  const nextEmployeeIds = candidateIds.filter((employeeId) => checkedIds.has(employeeId));

  const { user } = await requireUser();
  const result = await setServiceEmployeeEligibilities({
    userId: user.id,
    studioId,
    serviceId,
    employeeIds: nextEmployeeIds,
  });
  if (!result.ok) return err(result.message ?? "Could not save eligible employees.");

  revalidateDashboardContent("services");
  return ok("Eligible employees saved.");
}

export async function setServiceResourceRequirementsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!studioId || !serviceId) return err("Please fill the required fields.");

  const requirements = [] as Array<{ resourceType: ResourceType; requiredQuantity: number | null }>;
  for (const resourceType of RESOURCE_TYPES) {
    const parsed = parseQuantityInput(formData.get(`${resourceType}_qty`));
    if (!parsed.ok) {
      return err(`${resourceType}: ${parsed.message}`);
    }
    requirements.push({
      resourceType,
      requiredQuantity: parsed.value,
    });
  }

  const { user } = await requireUser();
  const result = await setServiceResourceRequirements({
    userId: user.id,
    studioId,
    serviceId,
    requirements,
  });
  if (!result.ok) return err(result.message ?? "Could not save resource requirements.");

  revalidateDashboardContent("services");
  return ok("Resource requirements saved.");
}

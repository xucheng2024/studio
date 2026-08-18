"use server";

import { revalidateDashboardContent } from "@/lib/revalidatePublic";
import {
  setServiceEmployeeEligibilities,
  setServiceResourceRequirements,
  updateStudioServiceAvailabilityDefaults,
  type ResourceType,
} from "@/lib/service-availability";
import { setServicePublishScope, type PublishScope } from "@/lib/service-locations";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function setServicePublishScopeAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const { user } = await requireUser();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const publishScope = String(formData.get("publish_scope") ?? "").trim() as PublishScope;
  if (!studioId || !serviceId) return err("Please fill the required fields.");
  if (publishScope !== "all_locations" && publishScope !== "selected_locations") {
    return err("Choose all locations or a selected list.");
  }
  const locationIds = [...new Set(formData.getAll("location_ids").map((value) => String(value).trim()).filter(Boolean))];
  if (publishScope === "selected_locations" && locationIds.length === 0) {
    return err("Select at least one location.");
  }

  const result = await setServicePublishScope({
    userId: user.id,
    studioId,
    serviceId,
    scope: publishScope,
    locationIds: publishScope === "all_locations" ? null : locationIds,
  });
  if (!result.ok) return err(result.message ?? "Could not save service locations.");

  revalidateDashboardContent("services");
  return ok("Service locations saved.");
}

export async function copyServiceBookingSetupAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const { user } = await requireUser();
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const sourceServiceId = String(formData.get("source_service_id") ?? "").trim();
  if (!studioId || !serviceId || !sourceServiceId) return err("Please fill the required fields.");
  if (sourceServiceId === serviceId) return err("Choose a different service.");

  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin
    .from("studio_services")
    .select("id, default_duration_minutes, default_prep_minutes, default_buffer_minutes, location_publish_scope")
    .eq("studio_id", studioId)
    .eq("id", sourceServiceId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) return err("Source service was not found.");

  const [{ data: employeeRows }, { data: requirementRows }, { data: locationRows }] = await Promise.all([
    admin
      .from("service_employees")
      .select("employee_id, is_active")
      .eq("studio_id", studioId)
      .eq("service_id", sourceServiceId),
    admin
      .from("service_resource_requirements")
      .select("resource_type, required_quantity")
      .eq("studio_id", studioId)
      .eq("service_id", sourceServiceId),
    admin
      .from("service_locations")
      .select("location_id, is_enabled")
      .eq("studio_id", studioId)
      .eq("service_id", sourceServiceId),
  ]);

  const defaultsResult = await updateStudioServiceAvailabilityDefaults({
    userId: user.id,
    studioId,
    serviceId,
    defaultDurationMinutes: Number(source.default_duration_minutes ?? 60),
    defaultPrepMinutes: Number(source.default_prep_minutes ?? 0),
    defaultBufferMinutes: Number(source.default_buffer_minutes ?? 0),
  });
  if (!defaultsResult.ok) return err(defaultsResult.message ?? "Could not copy appointment defaults.");

  const staffResult = await setServiceEmployeeEligibilities({
    userId: user.id,
    studioId,
    serviceId,
    employeeIds: (employeeRows ?? []).filter((row) => row.is_active).map((row) => row.employee_id),
  });
  if (!staffResult.ok) return err(staffResult.message ?? "Could not copy eligible staff.");

  const requirementMap = new Map<ResourceType, number>();
  for (const row of requirementRows ?? []) {
    const resourceType = row.resource_type as ResourceType;
    if (!RESOURCE_TYPES.includes(resourceType)) continue;
    requirementMap.set(resourceType, Number(row.required_quantity ?? 0));
  }
  const requirementsResult = await setServiceResourceRequirements({
    userId: user.id,
    studioId,
    serviceId,
    requirements: RESOURCE_TYPES.map((resourceType) => ({
      resourceType,
      requiredQuantity: requirementMap.get(resourceType) && requirementMap.get(resourceType)! > 0
        ? requirementMap.get(resourceType)!
        : null,
    })),
  });
  if (!requirementsResult.ok) return err(requirementsResult.message ?? "Could not copy resource requirements.");

  const enabledLocationIds = (locationRows ?? []).filter((row) => row.is_enabled).map((row) => row.location_id);
  const publishScope: PublishScope =
    source.location_publish_scope === "selected_locations" && enabledLocationIds.length > 0
      ? "selected_locations"
      : "all_locations";
  const locationResult = await setServicePublishScope({
    userId: user.id,
    studioId,
    serviceId,
    scope: publishScope,
    locationIds: publishScope === "all_locations" ? null : enabledLocationIds,
  });
  if (!locationResult.ok) return err(locationResult.message ?? "Could not copy service locations.");

  revalidateDashboardContent("services");
  return ok("Booking setup copied.");
}

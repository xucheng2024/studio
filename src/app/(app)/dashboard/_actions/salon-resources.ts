"use server";

import { revalidateDashboardSettings } from "@/lib/revalidatePublic";
import {
  setSalonResourceActive,
  upsertSalonResource,
  type ResourceType,
} from "@/lib/salon-resources";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

const RESOURCE_TYPES: ResourceType[] = ["room", "bed", "equipment", "other"];

export async function upsertSalonResourceAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const resourceType = String(formData.get("resource_type") ?? "").trim() as ResourceType;
  const resourceId = String(formData.get("resource_id") ?? "").trim() || null;
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const capacity = capacityRaw ? Number(capacityRaw) : 1;

  if (!studioId || !locationId || !name) return err("Please fill the required fields.");
  if (!RESOURCE_TYPES.includes(resourceType)) return err("Invalid resource type.");
  if (!Number.isFinite(capacity) || capacity <= 0) return err("Capacity must be a positive number.");

  const { user } = await requireUser();
  const result = await upsertSalonResource({
    userId: user.id,
    studioId,
    locationId,
    name,
    resourceType,
    capacity: Math.floor(capacity),
    resourceId,
  });
  if (!result.ok) return err(result.message ?? "Could not save resource.");

  revalidateDashboardSettings("resources");
  return ok(resourceId ? "Resource updated." : "Resource created.");
}

export async function setSalonResourceActiveAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const resourceId = String(formData.get("resource_id") ?? "").trim();
  const nextActive = formData.get("next_active") === "true";
  if (!studioId || !resourceId) return err("Please fill the required fields.");

  const { user } = await requireUser();
  const result = await setSalonResourceActive({ userId: user.id, studioId, resourceId, isActive: nextActive });
  if (!result.ok) return err(result.message ?? "Could not update resource status.");

  revalidateDashboardSettings("resources");
  return ok(nextActive ? "Resource enabled." : "Resource disabled.");
}

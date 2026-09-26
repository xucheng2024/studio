"use server";

import {
  applyRecommendedBookingSetup,
  publishSalonTermsVersion,
  setEmployeeTakesAppointments,
  setServiceOnlineBookable,
  updateBookingRules,
} from "@/lib/booking-setup";
import { setEmployeeWorkingLocations } from "@/lib/employees";
import {
  revalidateDashboardContent,
  revalidateDashboardSettings,
  revalidatePublicStudioPath,
} from "@/lib/revalidatePublic";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardFormResult, err, ok, requireUser } from "./shared";

async function revalidateBookingViews(studioId: string) {
  revalidateDashboardSettings("booking");
  revalidateDashboardSettings("locations");
  revalidateDashboardSettings("staff-availability");
  revalidateDashboardContent("services");
  const { data: studio } = await createAdminClient().from("studios").select("public_slug").eq("id", studioId).maybeSingle();
  if (studio?.public_slug) revalidatePublicStudioPath(studio.public_slug);
}

export async function applyRecommendedBookingSetupAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!studioId) return err("Missing studio.");
  const { user } = await requireUser();
  const result = await applyRecommendedBookingSetup({ userId: user.id, studioId });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok(result.changes.length ? result.changes.join(". ") + "." : "Nothing to fill — setup was already complete.");
}

export async function publishSalonTermsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const body = String(formData.get("terms_body") ?? "");
  if (!studioId) return err("Missing studio.");
  const { user } = await requireUser();
  const result = await publishSalonTermsVersion({ userId: user.id, studioId, body });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok(`Booking terms published as ${result.versionLabel}.`);
}

export async function updateBookingRulesAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!studioId) return err("Missing studio.");
  const minNoticeHours = Number(formData.get("min_notice_hours"));
  const maxAdvanceDays = Number(formData.get("max_advance_days"));
  const changeCutoffHours = Number(formData.get("change_cutoff_hours"));
  const { user } = await requireUser();
  const result = await updateBookingRules({
    userId: user.id,
    studioId,
    minNoticeMinutes: Math.round(minNoticeHours * 60),
    maxAdvanceDays,
    changeCutoffHours,
  });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok("Booking rules saved.");
}

export async function setServiceOnlineBookableAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const serviceId = String(formData.get("service_id") ?? "").trim();
  if (!studioId || !serviceId) return err("Please fill the required fields.");
  const onlineBookable = String(formData.get("online_bookable") ?? "") === "true";
  const { user } = await requireUser();
  const result = await setServiceOnlineBookable({ userId: user.id, studioId, serviceId, onlineBookable });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok(onlineBookable ? "Online booking turned on." : "Online booking turned off.");
}

export async function setEmployeeTakesAppointmentsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  if (!studioId || !employeeId) return err("Please fill the required fields.");
  const takesAppointments = String(formData.get("takes_appointments") ?? "") === "true";
  const { user } = await requireUser();
  const result = await setEmployeeTakesAppointments({ userId: user.id, studioId, employeeId, takesAppointments });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok(takesAppointments ? "Now takes appointments." : "No longer takes appointments.");
}

export async function setEmployeeBookingLocationsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const employeeId = String(formData.get("employee_id") ?? "").trim();
  const locationIds = [...new Set(formData.getAll("location_ids").map((value) => String(value).trim()).filter(Boolean))];
  if (!studioId || !employeeId) return err("Please fill the required fields.");
  if (!locationIds.length) return err("Select at least one location.");
  const { user } = await requireUser();
  const result = await setEmployeeWorkingLocations({
    userId: user.id,
    studioId,
    employeeId,
    locationIds,
    primaryLocationId: locationIds[0],
  });
  if (!result.ok) return err(result.message ?? result.reason);
  await revalidateBookingViews(studioId);
  return ok("Locations saved.");
}

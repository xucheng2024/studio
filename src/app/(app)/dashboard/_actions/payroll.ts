"use server";

import { revalidatePath } from "next/cache";
import {
  isOwnerPayrollRole,
  savePayrollProfileVersion,
  updateOwnEmployeeContact,
} from "@/lib/payroll-profiles";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import type { ResidencyStatus, SalaryType, ShgFund, ShgMode } from "@/lib/statutory-payroll";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

function text(raw: FormDataEntryValue | null) {
  return String(raw ?? "").trim();
}

function optionalText(raw: FormDataEntryValue | null) {
  return text(raw) || null;
}

function optionalEnum<T extends string>(raw: FormDataEntryValue | null, allowed: readonly T[]): T | null {
  const value = optionalText(raw);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function checkbox(formData: FormData, name: string) {
  const value = text(formData.get(name));
  return value === "on" || value === "true" || value === "1";
}

const RESIDENCY: readonly ResidencyStatus[] = ["citizen", "pr", "foreigner"];
const SALARY: readonly SalaryType[] = ["monthly", "hourly"];
const SHG_FUNDS: readonly ShgFund[] = ["none", "cdac", "ecf", "mbmf", "sinda"];
const SHG_MODES: readonly ShgMode[] = ["standard", "opt_out", "custom_amount"];

export async function savePayrollProfileAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const employeeId = text(formData.get("employee_id"));
  const effectiveFrom = text(formData.get("effective_from"));
  if (!studioId || !employeeId) return err("Select an employee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return err("Provide a valid effective date.");

  const { user } = await requireUser();
  const { ctx, studioIds } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId, locationId: null },
    ["owner"],
  );
  if (!studioIds.includes(studioId) || !isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return err("Only studio owners can maintain payroll profiles.");
  }

  try {
    const result = await savePayrollProfileVersion({
      studioId,
      employeeId,
      actorId: user.id,
      values: {
        job_title: optionalText(formData.get("job_title")),
        date_of_birth: optionalText(formData.get("date_of_birth")),
        residency_status: optionalEnum(formData.get("residency_status"), RESIDENCY),
        pr_granted_on: optionalText(formData.get("pr_granted_on")),
        salary_type: optionalEnum(formData.get("salary_type"), SALARY),
        basic_pay_sgd: optionalText(formData.get("basic_pay_sgd")),
        weekly_hours: optionalText(formData.get("weekly_hours")),
        cpf_full_rate_elected: checkbox(formData, "cpf_full_rate_elected"),
        shg_fund: optionalEnum(formData.get("shg_fund"), SHG_FUNDS),
        shg_mode: optionalEnum(formData.get("shg_mode"), SHG_MODES) ?? "standard",
        shg_custom_amount_sgd: optionalText(formData.get("shg_custom_amount_sgd")),
        shg_proof_note: optionalText(formData.get("shg_proof_note")),
        ea_part4_overtime_covered: checkbox(formData, "ea_part4_overtime_covered"),
        is_workman: checkbox(formData, "is_workman"),
        effective_from: effectiveFrom,
      },
    });
    revalidatePath("/dashboard/payroll");
    revalidatePath(`/dashboard/payroll/${employeeId}`);
    if (result.blockers.length) {
      return ok(`Profile saved. Finalise is still blocked: ${result.blockers.map((item) => item.message).join(" ")}`);
    }
    return ok("Payroll profile version saved.");
  } catch (error) {
    console.error("[PAY-01] savePayrollProfileAction failed", {
      studioId,
      employeeId,
      message: error instanceof Error ? error.message : String(error),
    });
    return err("Could not save the payroll profile.");
  }
}

export async function updateOwnPayrollContactAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const email = text(formData.get("email"));
  const phone = text(formData.get("phone"));
  if (!studioId) return err("Select a studio.");
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return err("Provide a valid email.");
  const { user } = await requireUser();
  try {
    const result = await updateOwnEmployeeContact({ userId: user.id, studioId, email, phone });
    if (!result.ok) return err("No employee record is linked to this account.");
    revalidatePath("/dashboard/payroll/me");
    return ok("Email and phone updated.");
  } catch (error) {
    console.error("[PAY-01] updateOwnPayrollContactAction failed", {
      studioId,
      message: error instanceof Error ? error.message : String(error),
    });
    return err("Could not update contact details.");
  }
}

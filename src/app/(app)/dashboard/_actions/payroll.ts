"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isOwnerPayrollRole,
  savePayrollProfileVersion,
  updateOwnEmployeeContact,
} from "@/lib/payroll-profiles";
import {
  createPayrollDraftRun,
  getPreviousPublishedPayrollRun,
  getPayrollRun,
  recalculatePayrollRun,
  transitionPayrollRun,
} from "@/lib/payroll-runs";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import type { ResidencyStatus, SalaryType, ShgFund, ShgMode } from "@/lib/statutory-payroll";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

function text(raw: FormDataEntryValue | null) {
  return String(raw ?? "").trim();
}

function optionalText(raw: FormDataEntryValue | null) {
  return text(raw) || null;
}

async function requireOwner(studioId: string) {
  const { user } = await requireUser();
  const { ctx, studioIds } = await getDashboardScopeForRoles(
    { userId: user.id, email: user.email, studioId, locationId: null },
    ["owner"],
  );
  if (!studioIds.includes(studioId) || !isOwnerPayrollRole({ isSuperAdmin: ctx.isSuperAdmin, memberships: ctx.memberships, studioId })) {
    return { ok: false as const, user };
  }
  return { ok: true as const, user };
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
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can maintain payroll profiles.");
  try {
    const result = await savePayrollProfileVersion({
      studioId,
      employeeId,
      actorId: access.user.id,
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

export async function createPayrollRunAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const month = text(formData.get("period_month"));
  if (!studioId || !/^\d{4}-\d{2}$/.test(month)) return err("Choose a payroll month.");
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can create payroll runs.");
  let runId = "";
  try {
    runId = await createPayrollDraftRun({
      studioId,
      actorId: access.user.id,
      periodStart: `${month}-01`,
    });
    revalidatePath("/dashboard/payroll");
    revalidatePath(`/dashboard/payroll/runs/${runId}`);
  } catch (error) {
    console.error("[PAY-02] createPayrollRunAction failed", { studioId, message: error instanceof Error ? error.message : String(error) });
    return err(error instanceof Error && error.message.includes("duplicate") ? "An active run already exists for that month." : "Could not create the payroll run.");
  }
  redirect(`/dashboard/payroll/runs/${runId}?studio_id=${encodeURIComponent(studioId)}`);
}

export async function savePayrollRunEmployeeInputsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const runId = text(formData.get("run_id"));
  const employeeId = text(formData.get("employee_id"));
  if (!studioId || !runId || !employeeId) return err("Select an employee.");
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can edit payroll runs.");
  try {
    await recalculatePayrollRun({
      studioId,
      actorId: access.user.id,
      runId,
      inputPatch: {
        employee_id: employeeId,
        working_days_in_month: optionalText(formData.get("working_days_in_month")),
        days_actually_worked: optionalText(formData.get("days_actually_worked")),
        hours_worked: optionalText(formData.get("hours_worked")),
        overtime_hours: optionalText(formData.get("overtime_hours")),
        contract_overtime_sgd: optionalText(formData.get("contract_overtime_sgd")),
        allowance_sgd: optionalText(formData.get("allowance_sgd")),
        bonus_sgd: optionalText(formData.get("bonus_sgd")),
        unpaid_absence_sgd: optionalText(formData.get("unpaid_absence_sgd")),
        other_deduction_sgd: optionalText(formData.get("other_deduction_sgd")),
        input_note: optionalText(formData.get("input_note")),
      },
    });
    revalidatePath(`/dashboard/payroll/runs/${runId}`);
    return ok("Employee inputs saved and the draft recalculated.");
  } catch (error) {
    console.error("[PAY-02] savePayrollRunEmployeeInputsAction failed", { runId, message: error instanceof Error ? error.message : String(error) });
    return err("Could not save payroll inputs.");
  }
}

export async function copyPreviousPayrollAttendanceAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const runId = text(formData.get("run_id"));
  if (!studioId || !runId) return err("Missing payroll run.");
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can edit payroll runs.");
  try {
    const run = await getPayrollRun(studioId, runId);
    if (!run) return err("Payroll run not found.");
    const previous = await getPreviousPublishedPayrollRun(studioId, run.period_start);
    if (!previous) return err("No previous published run to copy from.");
    await recalculatePayrollRun({
      studioId,
      actorId: access.user.id,
      runId,
      copyAttendanceFromRunId: previous.id,
    });
    revalidatePath(`/dashboard/payroll/runs/${runId}`);
    return ok("Copied last month's days and hours, then recalculated.");
  } catch (error) {
    console.error("[PAY-02] copyPreviousPayrollAttendanceAction failed", { runId, message: error instanceof Error ? error.message : String(error) });
    return err("Could not copy last month's days and hours.");
  }
}

export async function recalculatePayrollRunAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const runId = text(formData.get("run_id"));
  if (!studioId || !runId) return err("Missing payroll run.");
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can recalculate payroll.");
  try {
    await recalculatePayrollRun({ studioId, actorId: access.user.id, runId });
    revalidatePath(`/dashboard/payroll/runs/${runId}`);
    return ok("Draft recalculated from current profiles and commission entries.");
  } catch (error) {
    console.error("[PAY-02] recalculatePayrollRunAction failed", { runId, message: error instanceof Error ? error.message : String(error) });
    return err("Could not recalculate the payroll run.");
  }
}

export async function transitionPayrollRunAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = text(formData.get("studio_id"));
  const runId = text(formData.get("run_id"));
  const toStatus = text(formData.get("to_status"));
  if (!studioId || !runId || !["finalised", "paid", "voided"].includes(toStatus)) return err("Choose a payroll action.");
  const access = await requireOwner(studioId);
  if (!access.ok) return err("Only studio owners can change payroll status.");
  try {
    await transitionPayrollRun({
      studioId,
      actorId: access.user.id,
      runId,
      toStatus: toStatus as "finalised" | "paid" | "voided",
      paidOn: optionalText(formData.get("paid_on")),
      paymentReference: optionalText(formData.get("payment_reference")),
      voidReason: optionalText(formData.get("void_reason")),
    });
    revalidatePath("/dashboard/payroll");
    revalidatePath(`/dashboard/payroll/runs/${runId}`);
    revalidatePath("/dashboard/payroll/me");
    revalidatePath("/dashboard/payroll/reports");
    console.log("[PAY-02] transitionPayrollRunAction ok", { runId, toStatus });
    return ok(toStatus === "finalised" ? "Payroll finalised." : toStatus === "paid" ? "Payroll marked paid." : "Payroll voided.");
  } catch (error) {
    console.error("[PAY-02] transitionPayrollRunAction failed", { runId, toStatus, message: error instanceof Error ? error.message : String(error) });
    return err(error instanceof Error ? error.message.replace(/^.*finalise blocked: /i, "Finalise blocked: ") : "Could not update payroll status.");
  }
}

import "server-only";

import { writeStrongAudit } from "@/lib/strong-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateProfileForFinalise,
  type PayrollProfileInput,
  type ResidencyStatus,
  type SalaryType,
  type ShgFund,
  type ShgMode,
} from "@/lib/statutory-payroll";

export type PayrollEmployeeRow = {
  id: string;
  display_name: string;
  employee_number: string | null;
  email: string | null;
  phone: string | null;
  hired_at: string | null;
  terminated_at: string | null;
  employment_status: string | null;
  user_id: string | null;
};

export type PayrollProfileVersion = {
  id: string;
  studio_id: string;
  employee_id: string;
  job_title: string | null;
  date_of_birth: string | null;
  residency_status: ResidencyStatus | null;
  pr_granted_on: string | null;
  salary_type: SalaryType | null;
  basic_pay_sgd: string | null;
  weekly_hours: string | null;
  cpf_full_rate_elected: boolean;
  shg_fund: ShgFund | null;
  shg_mode: ShgMode;
  shg_custom_amount_sgd: string | null;
  shg_proof_note: string | null;
  ea_part4_overtime_covered: boolean;
  is_workman: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export type PayrollProfileSaveValues = {
  job_title: string | null;
  date_of_birth: string | null;
  residency_status: ResidencyStatus | null;
  pr_granted_on: string | null;
  salary_type: SalaryType | null;
  basic_pay_sgd: string | null;
  weekly_hours: string | null;
  cpf_full_rate_elected: boolean;
  shg_fund: ShgFund | null;
  shg_mode: ShgMode;
  shg_custom_amount_sgd: string | null;
  shg_proof_note: string | null;
  ea_part4_overtime_covered: boolean;
  is_workman: boolean;
  effective_from: string;
};

const PROFILE_COLUMNS =
  "id, studio_id, employee_id, job_title, date_of_birth, residency_status, pr_granted_on, salary_type, basic_pay_sgd, weekly_hours, cpf_full_rate_elected, shg_fund, shg_mode, shg_custom_amount_sgd, shg_proof_note, ea_part4_overtime_covered, is_workman, effective_from, effective_to, created_at";

export function isOwnerPayrollRole(params: {
  isSuperAdmin: boolean;
  memberships: Array<{ studio_id: string; location_id: string | null; role: string }>;
  studioId: string;
}) {
  if (params.isSuperAdmin) return true;
  return params.memberships.some(
    (membership) => membership.studio_id === params.studioId && membership.role === "owner" && membership.location_id == null,
  );
}

export async function listStudioEmployeesForPayroll(studioId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id, display_name, employee_number, email, phone, hired_at, terminated_at, employment_status, user_id")
    .eq("studio_id", studioId)
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as PayrollEmployeeRow[];
}

export async function getStudioEmployeeForPayroll(studioId: string, employeeId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employees")
    .select("id, display_name, employee_number, email, phone, hired_at, terminated_at, employment_status, user_id")
    .eq("studio_id", studioId)
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return (data as PayrollEmployeeRow | null) ?? null;
}

export async function getOwnEmployeeForPayroll(userId: string, studioId?: string | null) {
  const admin = createAdminClient();
  let query = admin
    .from("employees")
    .select("id, studio_id, display_name, employee_number, email, phone, hired_at, terminated_at, employment_status, user_id")
    .eq("user_id", userId)
    .order("display_name");
  if (studioId) query = query.eq("studio_id", studioId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<PayrollEmployeeRow & { studio_id: string }>;
  return rows[0] ?? null;
}

export async function listCurrentPayrollProfiles(studioId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employee_payroll_profile_versions")
    .select(PROFILE_COLUMNS)
    .eq("studio_id", studioId)
    .is("effective_to", null);
  if (error) throw error;
  return (data ?? []) as PayrollProfileVersion[];
}

export async function getCurrentPayrollProfile(studioId: string, employeeId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employee_payroll_profile_versions")
    .select(PROFILE_COLUMNS)
    .eq("studio_id", studioId)
    .eq("employee_id", employeeId)
    .is("effective_to", null)
    .maybeSingle();
  if (error) throw error;
  return (data as PayrollProfileVersion | null) ?? null;
}

export async function listPayrollProfileHistory(studioId: string, employeeId: string, limit = 8) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employee_payroll_profile_versions")
    .select(PROFILE_COLUMNS)
    .eq("studio_id", studioId)
    .eq("employee_id", employeeId)
    .order("effective_from", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PayrollProfileVersion[];
}

export function profileToInput(row: PayrollProfileVersion | null): PayrollProfileInput {
  return {
    residencyStatus: row?.residency_status ?? null,
    prGrantedOn: row?.pr_granted_on ?? null,
    dateOfBirth: row?.date_of_birth ?? null,
    salaryType: row?.salary_type ?? null,
    basicPaySgd: row?.basic_pay_sgd ?? null,
    weeklyHours: row?.weekly_hours ?? null,
    cpfFullRateElected: Boolean(row?.cpf_full_rate_elected),
    shgFund: row?.shg_fund ?? null,
    shgMode: row?.shg_mode ?? "standard",
    shgCustomAmountSgd: row?.shg_custom_amount_sgd ?? null,
    shgProofNote: row?.shg_proof_note ?? null,
    eaPart4OvertimeCovered: Boolean(row?.ea_part4_overtime_covered),
    isWorkman: Boolean(row?.is_workman),
  };
}

export async function savePayrollProfileVersion(params: {
  studioId: string;
  employeeId: string;
  actorId: string;
  values: PayrollProfileSaveValues;
}) {
  const blockers = validateProfileForFinalise(profileToInput({
    id: "",
    studio_id: params.studioId,
    employee_id: params.employeeId,
    created_at: "",
    effective_to: null,
    ...params.values,
  }));
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pay01_save_payroll_profile_version", {
    p_studio_id: params.studioId,
    p_employee_id: params.employeeId,
    p_actor_id: params.actorId,
    p_job_title: params.values.job_title,
    p_date_of_birth: params.values.date_of_birth,
    p_residency_status: params.values.residency_status,
    p_pr_granted_on: params.values.pr_granted_on,
    p_salary_type: params.values.salary_type,
    p_basic_pay_sgd: params.values.basic_pay_sgd,
    p_weekly_hours: params.values.weekly_hours,
    p_cpf_full_rate_elected: params.values.cpf_full_rate_elected,
    p_shg_fund: params.values.shg_fund,
    p_shg_mode: params.values.shg_mode,
    p_shg_custom_amount_sgd: params.values.shg_custom_amount_sgd,
    p_shg_proof_note: params.values.shg_proof_note,
    p_ea_part4_overtime_covered: params.values.ea_part4_overtime_covered,
    p_is_workman: params.values.is_workman,
    p_effective_from: params.values.effective_from,
  });
  if (error) throw error;
  return { id: String(data), blockers };
}

export async function updateOwnEmployeeContact(params: {
  userId: string;
  studioId: string;
  email: string;
  phone: string;
}) {
  const admin = createAdminClient();
  const { data: employee, error: lookupError } = await admin
    .from("employees")
    .select("id, studio_id, email, phone")
    .eq("user_id", params.userId)
    .eq("studio_id", params.studioId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!employee) return { ok: false as const, reason: "not_employee" as const };
  const { error } = await admin
    .from("employees")
    .update({ email: params.email, phone: params.phone })
    .eq("id", employee.id)
    .eq("user_id", params.userId)
    .eq("studio_id", params.studioId);
  if (error) throw error;
  await writeStrongAudit({
    studioId: employee.studio_id,
    actorType: "user",
    actorId: params.userId,
    actorRole: "employee",
    action: "employee_contact_self_updated",
    targetType: "employee",
    targetId: employee.id,
    afterState: { email_updated: true, phone_updated: true },
  });
  return { ok: true as const, employeeId: employee.id as string, studioId: employee.studio_id as string };
}

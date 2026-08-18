import "server-only";

import {
  getCurrentPayrollProfile,
  listStudioEmployeesForPayroll,
  profileToInput,
  type PayrollProfileVersion,
} from "@/lib/payroll-profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PAY01_RULE_ID,
  companySdlCentsFromEmployees,
  computeEmployeePayrollRun,
  fromCents,
  monthEndFromStart,
  type PeriodInputs,
} from "@/lib/statutory-payroll";

export type PayrollRunRow = {
  id: string;
  studio_id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "finalised" | "paid" | "voided";
  rule_version_id: string;
  company_sdl_sgd: string | null;
  paid_on: string | null;
  payment_reference: string | null;
  void_reason: string | null;
  created_at: string;
};

export type PayrollRunEmployeeRow = {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  profile_version_id: string | null;
  working_days_in_month: string | null;
  days_actually_worked: string | null;
  hours_worked: string | null;
  overtime_hours: string | null;
  contract_overtime_sgd: string | null;
  allowance_sgd: string | null;
  bonus_sgd: string | null;
  unpaid_absence_sgd: string | null;
  other_deduction_sgd: string | null;
  input_note: string | null;
  gross_sgd: string;
  total_deductions_sgd: string;
  net_sgd: string;
  ow_sgd: string;
  aw_sgd: string;
  employee_cpf_sgd: string;
  employer_cpf_sgd: string;
  sdl_sgd: string;
  shg_sgd: string;
  blocker_codes: string[];
};

function sgtRange(periodStart: string, periodEnd: string) {
  const [y, m, d] = periodEnd.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  const next = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  return {
    from: `${periodStart}T00:00:00+08:00`,
    to: `${next}T00:00:00+08:00`,
  };
}

export async function listPayrollRuns(studioId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payroll_runs")
    .select("id, studio_id, period_start, period_end, status, rule_version_id, company_sdl_sgd, paid_on, payment_reference, void_reason, created_at")
    .eq("studio_id", studioId)
    .order("period_start", { ascending: false })
    .limit(24);
  if (error) throw error;
  return (data ?? []) as PayrollRunRow[];
}

export async function getPayrollRun(studioId: string, runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payroll_runs")
    .select("id, studio_id, period_start, period_end, status, rule_version_id, company_sdl_sgd, paid_on, payment_reference, void_reason, created_at")
    .eq("studio_id", studioId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return (data as PayrollRunRow | null) ?? null;
}

export async function listPayrollRunEmployees(runId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payroll_run_employees")
    .select("*")
    .eq("payroll_run_id", runId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as PayrollRunEmployeeRow[];
}

export async function listPayrollRunLines(runEmployeeIds: string[]) {
  if (!runEmployeeIds.length) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payroll_line_items")
    .select("id, payroll_run_employee_id, item_code, amount_sgd, wage_class, sort_order")
    .in("payroll_run_employee_id", runEmployeeIds)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

async function profileForPeriod(studioId: string, employeeId: string, periodStart: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("employee_payroll_profile_versions")
    .select("*")
    .eq("studio_id", studioId)
    .eq("employee_id", employeeId)
    .lte("effective_from", periodStart)
    .or(`effective_to.is.null,effective_to.gt.${periodStart}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data as PayrollProfileVersion | null) ?? await getCurrentPayrollProfile(studioId, employeeId));
}

async function yearToDateOwSgd(studioId: string, employeeId: string, periodStart: string) {
  const year = periodStart.slice(0, 4);
  const admin = createAdminClient();
  const { data: runs, error: runError } = await admin
    .from("payroll_runs")
    .select("id")
    .eq("studio_id", studioId)
    .in("status", ["finalised", "paid"])
    .gte("period_start", `${year}-01-01`)
    .lt("period_start", periodStart);
  if (runError) throw runError;
  const runIds = (runs ?? []).map((row) => row.id as string);
  if (!runIds.length) return "0.00";
  const { data, error } = await admin
    .from("payroll_run_employees")
    .select("ow_sgd")
    .eq("employee_id", employeeId)
    .in("payroll_run_id", runIds);
  if (error) throw error;
  const total = (data ?? []).reduce((sum, row) => sum + Number(row.ow_sgd ?? 0), 0);
  return total.toFixed(2);
}

async function commissionForPeriod(studioId: string, employeeId: string, periodStart: string, periodEnd: string, runId: string) {
  const admin = createAdminClient();
  const range = sgtRange(periodStart, periodEnd);
  const { data: entries, error } = await admin
    .from("service_commission_entries")
    .select("id, amount")
    .eq("studio_id", studioId)
    .eq("employee_id", employeeId)
    .gte("created_at", range.from)
    .lt("created_at", range.to);
  if (error) throw error;
  const ids = (entries ?? []).map((row) => row.id as string);
  if (!ids.length) return { amountSgd: "0.00", entryIds: [] as string[] };
  const { data: locks, error: lockError } = await admin
    .from("payroll_commission_locks")
    .select("commission_entry_id, payroll_run_id")
    .in("commission_entry_id", ids);
  if (lockError) throw lockError;
  const lockedElsewhere = new Set(
    (locks ?? []).filter((row) => row.payroll_run_id !== runId).map((row) => row.commission_entry_id as string),
  );
  const usable = (entries ?? []).filter((row) => !lockedElsewhere.has(row.id as string));
  const amount = usable.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  return { amountSgd: amount.toFixed(2), entryIds: usable.map((row) => row.id as string) };
}

function inputsFromRow(row: PayrollRunEmployeeRow | undefined): PeriodInputs {
  return {
    periodStart: "",
    ordinaryWagesSgd: "0",
    workingDaysInMonth: row?.working_days_in_month,
    daysActuallyWorked: row?.days_actually_worked,
    hoursWorked: row?.hours_worked,
    overtimeHours: row?.overtime_hours,
    contractOvertimeAmountSgd: row?.contract_overtime_sgd,
    allowanceSgd: row?.allowance_sgd,
    bonusSgd: row?.bonus_sgd,
    unpaidAbsenceSgd: row?.unpaid_absence_sgd,
    otherDeductionSgd: row?.other_deduction_sgd,
  };
}

export async function createPayrollDraftRun(params: { studioId: string; actorId: string; periodStart: string }) {
  if (!monthEndFromStart(params.periodStart)) throw new Error("period must start on the first day of the month");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("pay02_create_draft_run", {
    p_studio_id: params.studioId,
    p_actor_id: params.actorId,
    p_period_start: params.periodStart,
    p_rule_version_id: PAY01_RULE_ID,
  });
  if (error) throw error;
  const runId = String(data);
  await recalculatePayrollRun({ studioId: params.studioId, actorId: params.actorId, runId });
  return runId;
}

export async function recalculatePayrollRun(params: {
  studioId: string;
  actorId: string;
  runId: string;
  inputPatch?: Partial<PayrollRunEmployeeRow> & { employee_id: string };
}) {
  const run = await getPayrollRun(params.studioId, params.runId);
  if (!run) throw new Error("payroll run not found");
  if (run.status !== "draft") throw new Error("only draft payroll runs can be recalculated");
  const employees = await listStudioEmployeesForPayroll(params.studioId);
  const existing = await listPayrollRunEmployees(params.runId);
  const existingById = new Map(existing.map((row) => [row.employee_id, row]));
  if (params.inputPatch) {
    existingById.set(params.inputPatch.employee_id, {
      ...(existingById.get(params.inputPatch.employee_id) ?? {
        id: "",
        payroll_run_id: params.runId,
        employee_id: params.inputPatch.employee_id,
        profile_version_id: null,
        working_days_in_month: null,
        days_actually_worked: null,
        hours_worked: null,
        overtime_hours: null,
        contract_overtime_sgd: null,
        allowance_sgd: null,
        bonus_sgd: null,
        unpaid_absence_sgd: null,
        other_deduction_sgd: null,
        input_note: null,
        gross_sgd: "0",
        total_deductions_sgd: "0",
        net_sgd: "0",
        ow_sgd: "0",
        aw_sgd: "0",
        employee_cpf_sgd: "0",
        employer_cpf_sgd: "0",
        sdl_sgd: "0",
        shg_sgd: "0",
        blocker_codes: [],
      }),
      ...params.inputPatch,
    });
  }

  const payload = [];
  const sdlCents: number[] = [];
  for (const employee of employees) {
    const profile = await profileForPeriod(params.studioId, employee.id, run.period_start);
    const stored = existingById.get(employee.id);
    const period = { ...inputsFromRow(stored), periodStart: run.period_start };
    const commission = await commissionForPeriod(params.studioId, employee.id, run.period_start, run.period_end, params.runId);
    period.commissionSgd = commission.amountSgd;
    period.yearToDateOwSubjectToCpfSgd = await yearToDateOwSgd(params.studioId, employee.id, run.period_start);
    const computed = computeEmployeePayrollRun({ profile: profileToInput(profile), period });
    sdlCents.push(computed.sdlCents);
    payload.push({
      employee_id: employee.id,
      profile_version_id: profile?.id ?? "",
      working_days_in_month: stored?.working_days_in_month ?? "",
      days_actually_worked: stored?.days_actually_worked ?? "",
      hours_worked: stored?.hours_worked ?? "",
      overtime_hours: stored?.overtime_hours ?? "",
      contract_overtime_sgd: stored?.contract_overtime_sgd ?? "",
      allowance_sgd: stored?.allowance_sgd ?? "",
      bonus_sgd: stored?.bonus_sgd ?? "",
      unpaid_absence_sgd: stored?.unpaid_absence_sgd ?? "",
      other_deduction_sgd: stored?.other_deduction_sgd ?? "",
      input_note: stored?.input_note ?? "",
      gross_sgd: fromCents(computed.grossCents),
      total_deductions_sgd: fromCents(computed.deductionCents),
      net_sgd: fromCents(computed.netCents),
      ow_sgd: fromCents(computed.owCents),
      aw_sgd: fromCents(computed.awCents),
      employee_cpf_sgd: fromCents(computed.employeeCpfCents),
      employer_cpf_sgd: fromCents(computed.employerCpfCents),
      sdl_sgd: fromCents(computed.sdlCents),
      shg_sgd: fromCents(computed.shgCents),
      blocker_codes: computed.blockers.map((item) => item.code),
      commission_entry_ids: commission.entryIds,
      lines: computed.lines.map((line) => ({
        code: line.code,
        amount_sgd: fromCents(line.amountCents),
        wage_class: line.wageClass,
      })),
    });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("pay02_replace_draft_snapshot", {
    p_run_id: params.runId,
    p_actor_id: params.actorId,
    p_company_sdl_sgd: fromCents(companySdlCentsFromEmployees(sdlCents)),
    p_employees: payload,
  });
  if (error) throw error;
  return params.runId;
}

export async function transitionPayrollRun(params: {
  studioId: string;
  actorId: string;
  runId: string;
  toStatus: "finalised" | "paid" | "voided";
  paidOn?: string | null;
  paymentReference?: string | null;
  voidReason?: string | null;
}) {
  const run = await getPayrollRun(params.studioId, params.runId);
  if (!run) throw new Error("payroll run not found");
  const admin = createAdminClient();
  const { error } = await admin.rpc("pay02_transition_run", {
    p_run_id: params.runId,
    p_actor_id: params.actorId,
    p_to_status: params.toStatus,
    p_paid_on: params.paidOn ?? null,
    p_payment_reference: params.paymentReference ?? null,
    p_void_reason: params.voidReason ?? null,
  });
  if (error) throw error;
}

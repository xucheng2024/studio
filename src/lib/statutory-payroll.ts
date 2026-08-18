/** Official Singapore payroll rule helpers for PAY-01. Rates are copied from CPF Board / MOM pages, not guessed. */

export const PAY01_RULE_ID = "sg-2026-01-01";
export const PAY01_VERIFIED_AT = "2026-08-18";

export const OFFICIAL_SOURCES = {
  cpfRates: "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay",
  owCeiling: "https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling",
  awCeiling: "https://www.cpf.gov.sg/service/article/what-is-the-additional-wage-aw-ceiling",
  sdl: "https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy",
  shg: "https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups",
  incompleteMonth: "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary",
  overtime: "https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days",
} as const;

export type ResidencyStatus = "citizen" | "pr" | "foreigner";
export type SalaryType = "monthly" | "hourly";
export type ShgFund = "none" | "cdac" | "ecf" | "mbmf" | "sinda";
export type ShgMode = "standard" | "opt_out" | "custom_amount";

export type PayrollProfileInput = {
  residencyStatus: ResidencyStatus | null;
  prGrantedOn: string | null;
  dateOfBirth: string | null;
  salaryType: SalaryType | null;
  basicPaySgd: string | null;
  weeklyHours: string | null;
  cpfFullRateElected: boolean;
  shgFund: ShgFund | null;
  shgMode: ShgMode;
  shgCustomAmountSgd: string | null;
  shgProofNote: string | null;
  eaPart4OvertimeCovered: boolean;
  isWorkman: boolean;
};

export type PeriodInputs = {
  periodStart: string;
  ordinaryWagesSgd: string;
  additionalWagesSgd?: string;
  yearToDateOwSubjectToCpfSgd?: string;
  workingDaysInMonth?: string | null;
  daysActuallyWorked?: string | null;
  hoursWorked?: string | null;
  overtimeHours?: string | null;
  contractOvertimeAmountSgd?: string | null;
  unpaidAbsenceDays?: string | null;
  unpaidAbsenceSgd?: string | null;
  allowanceSgd?: string | null;
  bonusSgd?: string | null;
  otherDeductionSgd?: string | null;
  commissionSgd?: string | null;
};

export type Blocker = { code: string; message: string };

const FULL_RATE_BANDS = [
  { ageMaxExclusive: 55, employerPct: 17, employeePct: 20 },
  { ageMaxExclusive: 60, employerPct: 16, employeePct: 18 },
  { ageMaxExclusive: 65, employerPct: 12.5, employeePct: 12.5 },
  { ageMaxExclusive: 70, employerPct: 9, employeePct: 7.5 },
  { ageMaxExclusive: Infinity, employerPct: 7.5, employeePct: 5 },
] as const;

const SHG_BANDS: Record<Exclude<ShgFund, "none">, Array<{ upToSgd: number; amountSgd: number }>> = {
  cdac: [
    { upToSgd: 2000, amountSgd: 0.5 },
    { upToSgd: 3500, amountSgd: 1 },
    { upToSgd: 5000, amountSgd: 1.5 },
    { upToSgd: 7500, amountSgd: 2 },
    { upToSgd: Infinity, amountSgd: 3 },
  ],
  ecf: [
    { upToSgd: 1000, amountSgd: 2 },
    { upToSgd: 1500, amountSgd: 4 },
    { upToSgd: 2500, amountSgd: 6 },
    { upToSgd: 4000, amountSgd: 9 },
    { upToSgd: 7000, amountSgd: 12 },
    { upToSgd: 10000, amountSgd: 16 },
    { upToSgd: Infinity, amountSgd: 20 },
  ],
  mbmf: [
    { upToSgd: 1000, amountSgd: 3 },
    { upToSgd: 2000, amountSgd: 4.5 },
    { upToSgd: 3000, amountSgd: 6.5 },
    { upToSgd: 4000, amountSgd: 15 },
    { upToSgd: 6000, amountSgd: 19.5 },
    { upToSgd: 8000, amountSgd: 22 },
    { upToSgd: 10000, amountSgd: 24 },
    { upToSgd: Infinity, amountSgd: 26 },
  ],
  sinda: [
    { upToSgd: 1000, amountSgd: 1 },
    { upToSgd: 1500, amountSgd: 3 },
    { upToSgd: 2500, amountSgd: 5 },
    { upToSgd: 4500, amountSgd: 7 },
    { upToSgd: 7500, amountSgd: 9 },
    { upToSgd: 10000, amountSgd: 12 },
    { upToSgd: 15000, amountSgd: 18 },
    { upToSgd: Infinity, amountSgd: 30 },
  ],
};

export function toCents(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function requireCents(value: string | number | null | undefined, code: string, blockers: Blocker[]): number {
  const cents = toCents(value);
  if (cents == null || cents < 0) {
    blockers.push({ code, message: `Missing or invalid amount for ${code}` });
    return 0;
  }
  return cents;
}

type CivilDate = { y: number; m: number; d: number };

export function parseIsoDate(value: string | null | undefined): CivilDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map((part) => Number(part));
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return { y, m, d };
}

function addYears(date: CivilDate, years: number): CivilDate {
  return { y: date.y + years, m: date.m, d: date.d };
}

function startOfNextMonth(date: CivilDate): CivilDate {
  return date.m === 12 ? { y: date.y + 1, m: 1, d: 1 } : { y: date.y, m: date.m + 1, d: 1 };
}

function compareCivil(a: CivilDate, b: CivilDate) {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function sprContributionYear(prGrantedOn: string, periodStart: string): 1 | 2 | 3 | null {
  const granted = parseIsoDate(prGrantedOn);
  const period = parseIsoDate(periodStart);
  if (!granted || !period) return null;
  const secondYearStart = startOfNextMonth(addYears(granted, 1));
  const thirdYearStart = startOfNextMonth(addYears(granted, 2));
  if (compareCivil(period, secondYearStart) < 0) return 1;
  if (compareCivil(period, thirdYearStart) < 0) return 2;
  return 3;
}

export function cpfFullRateBand(dateOfBirth: string, periodStart: string) {
  const birth = parseIsoDate(dateOfBirth);
  const period = parseIsoDate(periodStart);
  if (!birth || !period) return null;
  if (compareCivil(period, startOfNextMonth(addYears(birth, 70))) >= 0) return FULL_RATE_BANDS[4];
  if (compareCivil(period, startOfNextMonth(addYears(birth, 65))) >= 0) return FULL_RATE_BANDS[3];
  if (compareCivil(period, startOfNextMonth(addYears(birth, 60))) >= 0) return FULL_RATE_BANDS[2];
  if (compareCivil(period, startOfNextMonth(addYears(birth, 55))) >= 0) return FULL_RATE_BANDS[1];
  return FULL_RATE_BANDS[0];
}

function roundTotalCpfCents(cents: number) {
  const dollars = cents / 100;
  return Math.round(dollars) * 100;
}

function dropCents(cents: number) {
  return Math.trunc(cents / 100) * 100;
}

export function computeSdlCents(totalWagesSgd: string): { sdlCents: number; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  const wages = requireCents(totalWagesSgd, "missing_total_wages", blockers);
  if (blockers.length) return { sdlCents: 0, blockers };
  const raw = Math.round(wages * 0.0025);
  const min = 200;
  const max = 1125;
  if (wages < 80000) return { sdlCents: min, blockers };
  if (wages > 450000) return { sdlCents: max, blockers };
  return { sdlCents: Math.min(max, Math.max(min, raw)), blockers };
}

export function computeShgCents(params: {
  fund: ShgFund | null;
  mode: ShgMode;
  customAmountSgd: string | null;
  proofNote: string | null;
  totalWagesSgd: string;
}): { shgCents: number; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  if (!params.fund || params.fund === "none") {
    blockers.push({ code: "missing_shg_community", message: "SHG fund/community is required before Finalise." });
    return { shgCents: 0, blockers };
  }
  if (params.mode === "opt_out") {
    if (!params.proofNote?.trim()) {
      blockers.push({ code: "missing_shg_opt_out_proof", message: "SHG opt-out requires a proof note." });
    }
    return { shgCents: 0, blockers };
  }
  if (params.mode === "custom_amount") {
    if (!params.proofNote?.trim()) {
      blockers.push({ code: "missing_shg_custom_proof", message: "Custom SHG amount requires a proof note." });
    }
    const custom = requireCents(params.customAmountSgd, "missing_shg_custom_amount", blockers);
    return { shgCents: custom, blockers };
  }
  const wages = toCents(params.totalWagesSgd) ?? 0;
  const band = SHG_BANDS[params.fund].find((row) => wages <= row.upToSgd * 100);
  return { shgCents: Math.round((band?.amountSgd ?? 0) * 100), blockers };
}

export function computeIncompleteMonthPayCents(params: {
  monthlyGrossSgd: string;
  workingDaysInMonth: string | null | undefined;
  daysActuallyWorked: string | null | undefined;
}): { payCents: number; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  const monthly = requireCents(params.monthlyGrossSgd, "missing_monthly_gross", blockers);
  const workingDays = Number(params.workingDaysInMonth);
  const worked = Number(params.daysActuallyWorked);
  if (!Number.isFinite(workingDays) || workingDays <= 0) {
    blockers.push({ code: "missing_working_days_in_month", message: "Owner must enter working days in the month (MOM incomplete-month formula)." });
  }
  if (!Number.isFinite(worked) || worked < 0) {
    blockers.push({ code: "missing_days_actually_worked", message: "Owner must enter days actually worked." });
  }
  if (blockers.length) return { payCents: 0, blockers };
  return { payCents: Math.round((monthly * worked) / workingDays), blockers };
}

export function computeStatutoryOvertimeCents(params: {
  covered: boolean;
  isWorkman: boolean;
  monthlyBasicSgd: string | null;
  overtimeHours: string | null | undefined;
  contractOvertimeAmountSgd: string | null | undefined;
}): { overtimeCents: number; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  if (!params.covered) {
    if (!params.contractOvertimeAmountSgd) return { overtimeCents: 0, blockers };
    const amount = requireCents(params.contractOvertimeAmountSgd, "invalid_contract_overtime", blockers);
    return { overtimeCents: amount, blockers };
  }
  const hours = Number(params.overtimeHours);
  if (!Number.isFinite(hours) || hours < 0) {
    blockers.push({ code: "missing_overtime_hours", message: "Statutory overtime requires entered overtime hours." });
    return { overtimeCents: 0, blockers };
  }
  if (hours > 72) {
    blockers.push({ code: "overtime_hours_exceed_72", message: "MOM caps overtime at 72 hours a month unless an exemption exists. First version blocks above 72." });
  }
  const monthly = requireCents(params.monthlyBasicSgd, "missing_monthly_basic_for_overtime", blockers);
  if (blockers.length) return { overtimeCents: 0, blockers };
  const capMonthly = params.isWorkman ? 450000 : 260000;
  const cappedMonthly = Math.min(monthly, capMonthly);
  let hourlyCents = (12 * cappedMonthly) / (52 * 44);
  if (!params.isWorkman) hourlyCents = Math.min(hourlyCents, 1360);
  const overtimeCents = Math.round(hourlyCents * 1.5 * hours);
  return { overtimeCents, blockers };
}

export function evaluateCpf(params: {
  profile: PayrollProfileInput;
  periodStart: string;
  ordinaryWagesSgd: string;
  additionalWagesSgd?: string;
  yearToDateOwSubjectToCpfSgd?: string;
}): { employeeCents: number; employerCents: number; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  const { profile } = params;
  if (!profile.residencyStatus) {
    blockers.push({ code: "missing_residency", message: "Residency status is required before Finalise." });
    return { employeeCents: 0, employerCents: 0, blockers };
  }
  if (profile.residencyStatus === "foreigner") {
    return { employeeCents: 0, employerCents: 0, blockers };
  }
  if (profile.residencyStatus === "pr" && !profile.prGrantedOn) {
    blockers.push({ code: "missing_pr_date", message: "PR granted date is required for CPF year of SPR status." });
  }
  if (!profile.dateOfBirth) {
    blockers.push({ code: "missing_date_of_birth", message: "Date of birth is required for CPF age bands." });
  }
  const ow = requireCents(params.ordinaryWagesSgd, "missing_ordinary_wages", blockers);
  if (blockers.some((item) => item.code.startsWith("missing_"))) {
    return { employeeCents: 0, employerCents: 0, blockers };
  }

  if (ow <= 5000) {
    return { employeeCents: 0, employerCents: 0, blockers };
  }
  if (ow <= 75000) {
    blockers.push({
      code: "cpf_wage_band_not_in_published_html_table",
      message: "CPF Board HTML only publishes the >$750 table used in this version. Wages $50.01–$750 must not be guessed.",
    });
    return { employeeCents: 0, employerCents: 0, blockers };
  }

  if (profile.residencyStatus === "pr") {
    const year = sprContributionYear(profile.prGrantedOn!, params.periodStart);
    if (year == null) {
      blockers.push({ code: "missing_pr_date", message: "PR granted date is required." });
      return { employeeCents: 0, employerCents: 0, blockers };
    }
    if (year < 3 && !profile.cpfFullRateElected) {
      blockers.push({
        code: "cpf_spr_graduated_table_not_seeded",
        message: "SPR year 1/2 graduated rates are only in CPF Board PDF tables. First version requires a recorded full-rate election or blocks Finalise.",
      });
      return { employeeCents: 0, employerCents: 0, blockers };
    }
  }

  const band = cpfFullRateBand(profile.dateOfBirth!, params.periodStart);
  if (!band) {
    blockers.push({ code: "missing_date_of_birth", message: "Date of birth is required." });
    return { employeeCents: 0, employerCents: 0, blockers };
  }
  const owCeiling = 800000;
  const aw = toCents(params.additionalWagesSgd) ?? 0;
  const ytdOw = toCents(params.yearToDateOwSubjectToCpfSgd) ?? 0;
  const owSubject = Math.min(ow, owCeiling);
  const awCeiling = Math.max(0, 10200000 - ytdOw);
  const awSubject = Math.min(aw, awCeiling);
  const wagesSubject = owSubject + awSubject;
  const totalRaw = Math.round((wagesSubject * (band.employerPct + band.employeePct)) / 100);
  const employeeRaw = Math.round((wagesSubject * band.employeePct) / 100);
  const total = roundTotalCpfCents(totalRaw);
  const employee = dropCents(employeeRaw);
  const employer = total - employee;
  return { employeeCents: employee, employerCents: employer, blockers };
}

export function validateProfileForFinalise(profile: PayrollProfileInput): Blocker[] {
  const blockers: Blocker[] = [];
  if (!profile.residencyStatus) blockers.push({ code: "missing_residency", message: "Residency status is required." });
  if (profile.residencyStatus === "pr" && !profile.prGrantedOn) blockers.push({ code: "missing_pr_date", message: "PR granted date is required." });
  if (!profile.dateOfBirth) blockers.push({ code: "missing_date_of_birth", message: "Date of birth is required." });
  if (!profile.salaryType) blockers.push({ code: "missing_salary_type", message: "Salary type is required." });
  if (toCents(profile.basicPaySgd) == null) blockers.push({ code: "missing_basic_pay", message: "Basic pay or hourly rate is required." });
  if (profile.salaryType === "hourly" && (toCents(profile.weeklyHours) == null || Number(profile.weeklyHours) <= 0)) {
    blockers.push({ code: "missing_weekly_hours", message: "Weekly hours are required for hourly employees." });
  }
  if (!profile.shgFund || profile.shgFund === "none") {
    blockers.push({ code: "missing_shg_community", message: "SHG community/fund is required." });
  }
  if ((profile.shgMode === "opt_out" || profile.shgMode === "custom_amount") && !profile.shgProofNote?.trim()) {
    blockers.push({ code: "missing_shg_proof", message: "SHG opt-out or custom amount requires proof notes." });
  }
  return blockers;
}

export function officialRuleSnapshot() {
  return {
    id: PAY01_RULE_ID,
    authority: "CPF Board / MOM / SWDA",
    verified_at: PAY01_VERIFIED_AT,
    source_effective_from: "2026-01-01",
    sources: OFFICIAL_SOURCES,
    cpf: {
      ow_monthly_ceiling_sgd: "8000.00",
      annual_salary_ceiling_sgd: "102000.00",
      published_full_rate_table_wages_above_sgd: "750.00",
      no_employee_share_at_or_below_sgd: "500.00",
      full_rates_from_1_jan_2026_wages_above_750: FULL_RATE_BANDS,
      rounding: {
        total: "nearest_dollar",
        employee_share: "drop_cents",
      },
    },
    sdl: {
      rate: "0.0025",
      min_sgd: "2.00",
      max_sgd: "11.25",
      low_wage_threshold_sgd: "800.00",
      high_wage_threshold_sgd: "4500.00",
      company_total_rounding: "round_down_to_dollar",
    },
    shg: SHG_BANDS,
    overtime: {
      multiplier: "1.5",
      monthly_hourly_formula: "(12 * monthly_basic) / (52 * 44)",
      non_workman_monthly_cap_sgd: "2600.00",
      workman_monthly_cap_sgd: "4500.00",
      monthly_hour_cap: 72,
    },
    incomplete_month: {
      formula: "monthly_gross / working_days_in_month * days_actually_worked",
    },
  };
}

export type PayrollWageClass = "ow" | "aw" | "none" | "employer";

export type PayrollComputedLine = {
  code: string;
  amountCents: number;
  wageClass: PayrollWageClass;
};

export function monthEndFromStart(periodStart: string): string | null {
  const start = parseIsoDate(periodStart);
  if (!start || start.d !== 1) return null;
  const lastDay = new Date(Date.UTC(start.y, start.m, 0)).getUTCDate();
  return `${String(start.y).padStart(4, "0")}-${String(start.m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function companySdlCentsFromEmployees(perEmployeeSdlCents: number[]) {
  const sum = perEmployeeSdlCents.reduce((total, value) => total + value, 0);
  return Math.floor(sum / 100) * 100;
}

export function computeEmployeePayrollRun(params: {
  profile: PayrollProfileInput;
  period: PeriodInputs;
}): {
  lines: PayrollComputedLine[];
  blockers: Blocker[];
  grossCents: number;
  deductionCents: number;
  netCents: number;
  employeeCpfCents: number;
  employerCpfCents: number;
  sdlCents: number;
  shgCents: number;
  owCents: number;
  awCents: number;
} {
  const blockers = validateProfileForFinalise(params.profile);
  const periodEnd = monthEndFromStart(params.period.periodStart);
  if (!periodEnd) blockers.push({ code: "invalid_period_start", message: "Payroll period must start on the first day of a calendar month." });

  let basicCents = 0;
  if (params.profile.salaryType === "hourly") {
    const rate = toCents(params.profile.basicPaySgd);
    const hours = Number(params.period.hoursWorked);
    if (rate == null) blockers.push({ code: "missing_basic_pay", message: "Hourly rate is required." });
    if (!Number.isFinite(hours) || hours < 0) {
      blockers.push({ code: "missing_hours_worked", message: "Owner must enter hours worked for hourly employees." });
    } else if (rate != null) {
      basicCents = Math.round(rate * hours);
    }
  } else if (params.profile.salaryType === "monthly") {
    const hasIncomplete = Boolean(params.period.workingDaysInMonth || params.period.daysActuallyWorked);
    if (hasIncomplete) {
      const incomplete = computeIncompleteMonthPayCents({
        monthlyGrossSgd: params.profile.basicPaySgd ?? "",
        workingDaysInMonth: params.period.workingDaysInMonth,
        daysActuallyWorked: params.period.daysActuallyWorked,
      });
      blockers.push(...incomplete.blockers);
      basicCents = incomplete.payCents;
    } else {
      basicCents = toCents(params.profile.basicPaySgd) ?? 0;
    }
  }

  const overtimeCovered = params.profile.eaPart4OvertimeCovered && params.profile.salaryType === "monthly";
  const overtime = computeStatutoryOvertimeCents({
    covered: overtimeCovered,
    isWorkman: params.profile.isWorkman,
    monthlyBasicSgd: params.profile.salaryType === "monthly" ? params.profile.basicPaySgd : null,
    overtimeHours: params.period.overtimeHours,
    contractOvertimeAmountSgd: params.period.contractOvertimeAmountSgd,
  });
  if (params.profile.eaPart4OvertimeCovered && params.profile.salaryType === "hourly" && Number(params.period.overtimeHours) > 0 && !params.period.contractOvertimeAmountSgd) {
    blockers.push({
      code: "hourly_overtime_needs_contract_amount",
      message: "Hourly staff are not computed on the MOM monthly overtime formula. Enter the contract overtime amount.",
    });
  }
  blockers.push(...overtime.blockers);

  const commissionCents = toCents(params.period.commissionSgd) ?? 0;
  const allowanceCents = toCents(params.period.allowanceSgd) ?? 0;
  const bonusCents = toCents(params.period.bonusSgd) ?? 0;
  const unpaidCents = toCents(params.period.unpaidAbsenceSgd) ?? 0;
  const otherDeductionCents = toCents(params.period.otherDeductionSgd) ?? 0;
  if (unpaidCents > basicCents + allowanceCents + overtime.overtimeCents + commissionCents) {
    blockers.push({ code: "unpaid_absence_exceeds_ordinary_wages", message: "Unpaid absence cannot exceed ordinary wages for the month." });
  }

  const basicCode: PayrollComputedLine["code"] = params.profile.salaryType === "hourly"
    ? "hourly_wages"
    : (params.period.workingDaysInMonth || params.period.daysActuallyWorked ? "incomplete_month" : "basic");
  const lines: PayrollComputedLine[] = [
    { code: basicCode, amountCents: basicCents, wageClass: "ow" },
  ];
  const optionalLines: PayrollComputedLine[] = [
    { code: "commission", amountCents: commissionCents, wageClass: "ow" },
    { code: "allowance", amountCents: allowanceCents, wageClass: "ow" },
    { code: "overtime", amountCents: overtime.overtimeCents, wageClass: "ow" },
    { code: "bonus", amountCents: bonusCents, wageClass: "aw" },
    { code: "unpaid_absence", amountCents: unpaidCents, wageClass: "ow" },
    { code: "other_deduction", amountCents: otherDeductionCents, wageClass: "none" },
  ];
  for (const line of optionalLines) {
    if (line.amountCents !== 0) lines.push(line);
  }

  const owCents = Math.max(0, basicCents + commissionCents + allowanceCents + overtime.overtimeCents - unpaidCents);
  const awCents = bonusCents;
  const cpf = evaluateCpf({
    profile: params.profile,
    periodStart: params.period.periodStart,
    ordinaryWagesSgd: fromCents(owCents),
    additionalWagesSgd: fromCents(awCents),
    yearToDateOwSubjectToCpfSgd: params.period.yearToDateOwSubjectToCpfSgd,
  });
  blockers.push(...cpf.blockers);

  const sdlWagesCents = owCents + awCents;
  const sdl = computeSdlCents(fromCents(sdlWagesCents));
  blockers.push(...sdl.blockers);
  const shg = computeShgCents({
    fund: params.profile.shgFund,
    mode: params.profile.shgMode,
    customAmountSgd: params.profile.shgCustomAmountSgd,
    proofNote: params.profile.shgProofNote,
    totalWagesSgd: fromCents(sdlWagesCents),
  });
  blockers.push(...shg.blockers);

  if (cpf.employeeCents) lines.push({ code: "employee_cpf", amountCents: cpf.employeeCents, wageClass: "none" });
  if (cpf.employerCents) lines.push({ code: "employer_cpf", amountCents: cpf.employerCents, wageClass: "employer" });
  if (sdl.sdlCents) lines.push({ code: "sdl", amountCents: sdl.sdlCents, wageClass: "employer" });
  if (shg.shgCents) lines.push({ code: "shg", amountCents: shg.shgCents, wageClass: "none" });

  const uniqueBlockers = [...new Map(blockers.map((item) => [item.code, item])).values()];
  const grossCents = basicCents + commissionCents + allowanceCents + overtime.overtimeCents + bonusCents;
  const deductionCents = unpaidCents + otherDeductionCents + cpf.employeeCents + shg.shgCents;
  return {
    lines,
    blockers: uniqueBlockers,
    grossCents,
    deductionCents,
    netCents: grossCents - deductionCents,
    employeeCpfCents: cpf.employeeCents,
    employerCpfCents: cpf.employerCents,
    sdlCents: sdl.sdlCents,
    shgCents: shg.shgCents,
    owCents,
    awCents,
  };
}

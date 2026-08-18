export type PayslipLine = {
  code: string;
  label: string;
  amountSgd: string;
  kind: "earning" | "deduction" | "employer";
};

export type PayslipModel = {
  payslipNumber: string;
  employerName: string;
  employeeName: string;
  employeeNumber: string | null;
  paymentDate: string;
  periodStart: string;
  periodEnd: string;
  basicSalaryLabel: string;
  basicRate: string | null;
  hoursOrDaysWorked: string | null;
  overtimeHours: string | null;
  overtimePay: string | null;
  overtimePeriodStart: string | null;
  overtimePeriodEnd: string | null;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  netSalary: string;
  ruleVersionId: string;
};

const EARNING_CODES = new Set(["basic", "hourly_wages", "incomplete_month", "commission", "allowance", "overtime", "bonus"]);
const DEDUCTION_CODES = new Set(["unpaid_absence", "other_deduction", "employee_cpf", "shg"]);
const EMPLOYER_CODES = new Set(["employer_cpf", "sdl"]);

export const PAYSLIP_LINE_LABELS: Record<string, string> = {
  basic: "Basic salary",
  hourly_wages: "Basic salary (hourly)",
  incomplete_month: "Basic salary (incomplete month)",
  commission: "Commission",
  allowance: "Allowances",
  overtime: "Overtime pay",
  bonus: "Bonus / additional payment",
  unpaid_absence: "Unpaid absence",
  other_deduction: "Other deduction",
  employee_cpf: "Employee CPF",
  shg: "SHG contribution",
  employer_cpf: "Employer CPF",
  sdl: "Skills Development Levy",
};

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function lineKind(code: string): PayslipLine["kind"] {
  if (EMPLOYER_CODES.has(code)) return "employer";
  if (DEDUCTION_CODES.has(code)) return "deduction";
  return "earning";
}

export function buildPayslipModel(params: {
  payslipNumber: string;
  employerName: string;
  employeeName: string;
  employeeNumber?: string | null;
  paymentDate?: string | null;
  periodStart: string;
  periodEnd: string;
  salaryType?: string | null;
  basicPaySgd?: string | null;
  hoursWorked?: string | null;
  daysActuallyWorked?: string | null;
  overtimeHours?: string | null;
  netSgd: string;
  ruleVersionId: string;
  lines: Array<{ item_code: string; amount_sgd: string | number }>;
}): PayslipModel {
  const earnings: PayslipLine[] = [];
  const deductions: PayslipLine[] = [];
  const employerContributions: PayslipLine[] = [];
  let overtimePay: string | null = null;
  for (const line of params.lines) {
    const mapped: PayslipLine = {
      code: line.item_code,
      label: PAYSLIP_LINE_LABELS[line.item_code] ?? line.item_code,
      amountSgd: money(line.amount_sgd),
      kind: EARNING_CODES.has(line.item_code) ? "earning" : lineKind(line.item_code),
    };
    if (mapped.kind === "earning") earnings.push(mapped);
    else if (mapped.kind === "deduction") deductions.push(mapped);
    else employerContributions.push(mapped);
    if (line.item_code === "overtime") overtimePay = money(line.amount_sgd);
  }

  const hourly = params.salaryType === "hourly";
  return {
    payslipNumber: params.payslipNumber,
    employerName: params.employerName,
    employeeName: params.employeeName,
    employeeNumber: params.employeeNumber ?? null,
    paymentDate: params.paymentDate || "Pending",
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    basicSalaryLabel: hourly ? "Basic salary (hourly)" : "Basic salary",
    basicRate: hourly ? (params.basicPaySgd ? `${money(params.basicPaySgd)} per hour` : null) : (params.basicPaySgd ? money(params.basicPaySgd) : null),
    hoursOrDaysWorked: hourly
      ? (params.hoursWorked ? `${params.hoursWorked} hours` : null)
      : (params.daysActuallyWorked ? `${params.daysActuallyWorked} days` : null),
    overtimeHours: params.overtimeHours || null,
    overtimePay,
    overtimePeriodStart: overtimePay ? params.periodStart : null,
    overtimePeriodEnd: overtimePay ? params.periodEnd : null,
    earnings,
    deductions,
    employerContributions,
    netSalary: money(params.netSgd),
    ruleVersionId: params.ruleVersionId,
  };
}

export function momRequiredFieldsPresent(model: PayslipModel) {
  return {
    employerName: Boolean(model.employerName.trim()),
    employeeName: Boolean(model.employeeName.trim()),
    paymentDate: Boolean(model.paymentDate.trim()),
    periodStart: Boolean(model.periodStart.trim()),
    periodEnd: Boolean(model.periodEnd.trim()),
    netSalary: Boolean(model.netSalary.trim()),
    payslipNumber: Boolean(model.payslipNumber.trim()),
  };
}

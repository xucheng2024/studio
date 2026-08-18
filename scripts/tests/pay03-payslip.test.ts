import assert from "node:assert/strict";
import test from "node:test";
import { buildPayslipModel, momRequiredFieldsPresent } from "../../src/lib/payslip-model.ts";

const monthlyLines = [
  { item_code: "basic", amount_sgd: "2000" },
  { item_code: "employee_cpf", amount_sgd: "400" },
  { item_code: "shg", amount_sgd: "0.50" },
  { item_code: "employer_cpf", amount_sgd: "340" },
  { item_code: "sdl", amount_sgd: "5.00" },
];

test("PAY-03 monthly snapshot keeps MOM required labels and pending payment date", () => {
  const model = buildPayslipModel({
    payslipNumber: "PAY-2026-08-ABCD1234",
    employerName: "PAY local studio",
    employeeName: "PAY local instructor",
    paymentDate: null,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    salaryType: "monthly",
    basicPaySgd: "2000",
    netSgd: "1599.50",
    ruleVersionId: "cpf-board-2026-01-html",
    lines: monthlyLines,
  });
  const fields = momRequiredFieldsPresent(model);
  assert.deepEqual(fields, {
    employerName: true,
    employeeName: true,
    paymentDate: true,
    periodStart: true,
    periodEnd: true,
    netSalary: true,
    payslipNumber: true,
  });
  assert.equal(model.paymentDate, "Pending");
  assert.equal(model.basicSalaryLabel, "Basic salary");
  assert.equal(model.netSalary, "1599.50");
  assert.deepEqual(model.deductions.map((line) => line.code), ["employee_cpf", "shg"]);
  assert.deepEqual(model.employerContributions.map((line) => line.code), ["employer_cpf", "sdl"]);
});

test("PAY-03 hourly payslip shows rate and hours", () => {
  const model = buildPayslipModel({
    payslipNumber: "PAY-2026-08-HOUR0001",
    employerName: "PAY local studio",
    employeeName: "Hourly staff",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    salaryType: "hourly",
    basicPaySgd: "15",
    hoursWorked: "40",
    netSgd: "600",
    ruleVersionId: "cpf-board-2026-01-html",
    lines: [{ item_code: "hourly_wages", amount_sgd: "600" }],
  });
  assert.equal(model.basicSalaryLabel, "Basic salary (hourly)");
  assert.equal(model.basicRate, "15.00 per hour");
  assert.equal(model.hoursOrDaysWorked, "40 hours");
});

test("PAY-03 overtime period matches the salary period and stays off deductions", () => {
  const model = buildPayslipModel({
    payslipNumber: "PAY-2026-08-OT000001",
    employerName: "PAY local studio",
    employeeName: "OT staff",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    salaryType: "monthly",
    basicPaySgd: "2000",
    overtimeHours: "4",
    netSgd: "2100",
    ruleVersionId: "cpf-board-2026-01-html",
    lines: [
      { item_code: "basic", amount_sgd: "2000" },
      { item_code: "overtime", amount_sgd: "100" },
    ],
  });
  assert.equal(model.overtimePay, "100.00");
  assert.equal(model.overtimePeriodStart, "2026-08-01");
  assert.equal(model.overtimePeriodEnd, "2026-08-31");
  assert.equal(model.deductions.length, 0);
  assert.equal(model.earnings.some((line) => line.code === "overtime"), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  companySdlCentsFromEmployees,
  computeEmployeePayrollRun,
  fromCents,
  type PayrollProfileInput,
} from "../../src/lib/statutory-payroll.ts";

const citizen: PayrollProfileInput = {
  residencyStatus: "citizen",
  prGrantedOn: null,
  dateOfBirth: "1990-06-15",
  salaryType: "monthly",
  basicPaySgd: "2000",
  weeklyHours: "44",
  cpfFullRateElected: false,
  shgFund: "cdac",
  shgMode: "standard",
  shgCustomAmountSgd: null,
  shgProofNote: null,
  eaPart4OvertimeCovered: false,
  isWorkman: false,
};

test("PAY-02 monthly citizen 2000 with commission keeps CPF 17/20 and SDL 5", () => {
  const result = computeEmployeePayrollRun({
    profile: citizen,
    period: {
      periodStart: "2026-08-01",
      ordinaryWagesSgd: "0",
      commissionSgd: "200",
    },
  });
  assert.equal(result.blockers.length, 0);
  assert.equal(fromCents(result.grossCents), "2200.00");
  assert.equal(fromCents(result.employeeCpfCents), "440.00");
  assert.equal(fromCents(result.employerCpfCents), "374.00");
  assert.equal(fromCents(result.sdlCents), "5.50");
  assert.equal(fromCents(result.shgCents), "1.00");
  assert.equal(fromCents(result.netCents), "1759.00");
});

test("PAY-02 bonus is additional wages and company SDL rounds down to the dollar", () => {
  const first = computeEmployeePayrollRun({
    profile: citizen,
    period: { periodStart: "2026-08-01", ordinaryWagesSgd: "0", bonusSgd: "500" },
  });
  assert.equal(fromCents(first.owCents), "2000.00");
  assert.equal(fromCents(first.awCents), "500.00");
  assert.equal(fromCents(companySdlCentsFromEmployees([first.sdlCents, 180])), "8.00");
});

test("PAY-02 missing hourly hours blocks Finalise", () => {
  const result = computeEmployeePayrollRun({
    profile: { ...citizen, salaryType: "hourly", basicPaySgd: "15" },
    period: { periodStart: "2026-08-01", ordinaryWagesSgd: "0" },
  });
  assert.equal(result.blockers.some((item) => item.code === "missing_hours_worked"), true);
});

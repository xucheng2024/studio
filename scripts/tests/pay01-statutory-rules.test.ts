import assert from "node:assert/strict";
import test from "node:test";
import {
  computeIncompleteMonthPayCents,
  computeSdlCents,
  computeShgCents,
  computeStatutoryOvertimeCents,
  evaluateCpf,
  fromCents,
  sprContributionYear,
  validateProfileForFinalise,
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
  eaPart4OvertimeCovered: true,
  isWorkman: false,
};

test("PAY-01 CPF citizen under 55 wages 2000 uses 17/20 from CPF Board 1 Jan 2026 HTML table", () => {
  const result = evaluateCpf({ profile: citizen, periodStart: "2026-08-01", ordinaryWagesSgd: "2000" });
  assert.deepEqual(result.blockers, []);
  assert.equal(fromCents(result.employeeCents), "400.00");
  assert.equal(fromCents(result.employerCents), "340.00");
});

test("PAY-01 CPF blocks wages at or below 750 because the HTML table is only for wages above 750", () => {
  const result = evaluateCpf({ profile: citizen, periodStart: "2026-08-01", ordinaryWagesSgd: "750" });
  assert.equal(result.blockers.some((item) => item.code === "cpf_wage_band_not_in_published_html_table"), true);
});

test("PAY-01 CPF foreigner has no CPF", () => {
  const result = evaluateCpf({
    profile: { ...citizen, residencyStatus: "foreigner" },
    periodStart: "2026-08-01",
    ordinaryWagesSgd: "2000",
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.employeeCents, 0);
  assert.equal(result.employerCents, 0);
});

test("PAY-01 SPR year 3 uses the published full-rate table", () => {
  const result = evaluateCpf({
    profile: { ...citizen, residencyStatus: "pr", prGrantedOn: "2023-03-10" },
    periodStart: "2026-08-01",
    ordinaryWagesSgd: "2000",
  });
  assert.equal(sprContributionYear("2023-03-10", "2026-08-01"), 3);
  assert.deepEqual(result.blockers, []);
  assert.equal(fromCents(result.employeeCents), "400.00");
  assert.equal(fromCents(result.employerCents), "340.00");
});

test("PAY-01 CPF age band changes from the first day of the month after the 55th birthday", () => {
  const result = evaluateCpf({
    profile: { ...citizen, dateOfBirth: "1970-06-15" },
    periodStart: "2026-08-01",
    ordinaryWagesSgd: "2000",
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(fromCents(result.employeeCents), "360.00");
  assert.equal(fromCents(result.employerCents), "320.00");
});

test("PAY-01 SDL matches CPF Board examples", () => {
  assert.equal(fromCents(computeSdlCents("609.50").sdlCents), "2.00");
  assert.equal(fromCents(computeSdlCents("2000").sdlCents), "5.00");
  assert.equal(fromCents(computeSdlCents("4500").sdlCents), "11.25");
  assert.equal(fromCents(computeSdlCents("4502.03").sdlCents), "11.25");
  assert.equal(fromCents(computeSdlCents("10000").sdlCents), "11.25");
});

test("PAY-01 SHG CDAC and MBMF use published wage bands", () => {
  assert.equal(fromCents(computeShgCents({ fund: "cdac", mode: "standard", customAmountSgd: null, proofNote: null, totalWagesSgd: "2000" }).shgCents), "0.50");
  assert.equal(fromCents(computeShgCents({ fund: "mbmf", mode: "standard", customAmountSgd: null, proofNote: null, totalWagesSgd: "3500" }).shgCents), "15.00");
});

test("PAY-01 incomplete month uses MOM working-day formula", () => {
  const result = computeIncompleteMonthPayCents({ monthlyGrossSgd: "3100", workingDaysInMonth: "22", daysActuallyWorked: "11" });
  assert.deepEqual(result.blockers, []);
  assert.equal(fromCents(result.payCents), "1550.00");
});

test("PAY-01 statutory overtime uses MOM monthly hourly formula", () => {
  const result = computeStatutoryOvertimeCents({
    covered: true,
    isWorkman: false,
    monthlyBasicSgd: "2600",
    overtimeHours: "2",
    contractOvertimeAmountSgd: null,
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(fromCents(result.overtimeCents), "40.80");
});

test("PAY-01 Finalise blockers cover residency, PR date and SHG", () => {
  const blockers = validateProfileForFinalise({
    ...citizen,
    residencyStatus: "pr",
    prGrantedOn: null,
    shgFund: "none",
  });
  assert.equal(blockers.some((item) => item.code === "missing_pr_date"), true);
  assert.equal(blockers.some((item) => item.code === "missing_shg_community"), true);
});

"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

type Props = {
  defaultSalaryType: string;
  defaultBasicPay: string;
  defaultWeeklyHours: string;
};

export function PayrollSalaryFields({ defaultSalaryType, defaultBasicPay, defaultWeeklyHours }: Props) {
  const [salaryType, setSalaryType] = useState(defaultSalaryType);
  const payLabel = salaryType === "hourly" ? "Hourly rate (SGD)" : salaryType === "monthly" ? "Monthly basic pay (SGD)" : "Pay amount (SGD)";

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Salary type</span>
        <select className={ui.select} name="salary_type" value={salaryType} onChange={(event) => setSalaryType(event.target.value)}>
          <option value="">Select</option>
          <option value="monthly">Monthly</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>{payLabel}</span>
        <input className={ui.input} name="basic_pay_sgd" type="number" min="0" step="0.01" defaultValue={defaultBasicPay} />
      </label>
      {salaryType === "hourly" ? (
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Weekly hours</span>
          <input className={ui.input} name="weekly_hours" type="number" min="0" step="0.01" defaultValue={defaultWeeklyHours} />
        </label>
      ) : null}
    </>
  );
}

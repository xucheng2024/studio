import type { PayslipModel } from "@/lib/payslip-model";
import { ui } from "@/lib/ui";

export function PayslipSheet({ model }: { model: PayslipModel }) {
  return (
    <article className={`${ui.card} print:border-0 print:shadow-none`}>
      <h1 className={ui.h1}>Itemised payslip</h1>
      <p className={`mt-1 ${ui.muted}`}>{model.payslipNumber} · MOM Employment Act itemised pay slip</p>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className={ui.muted}>Employer</dt><dd>{model.employerName}</dd></div>
        <div><dt className={ui.muted}>Employee</dt><dd>{model.employeeName}</dd></div>
        <div><dt className={ui.muted}>Payment date</dt><dd>{model.paymentDate}</dd></div>
        <div><dt className={ui.muted}>Salary period</dt><dd>{model.periodStart} to {model.periodEnd}</dd></div>
        <div><dt className={ui.muted}>{model.basicSalaryLabel}</dt><dd>{model.basicRate ?? "—"}</dd></div>
        {model.hoursOrDaysWorked ? <div><dt className={ui.muted}>Hours / days worked</dt><dd>{model.hoursOrDaysWorked}</dd></div> : null}
        {model.overtimeHours ? <div><dt className={ui.muted}>Overtime hours</dt><dd>{model.overtimeHours}</dd></div> : null}
        {model.overtimePay ? <div><dt className={ui.muted}>Overtime period</dt><dd>{model.overtimePeriodStart} to {model.overtimePeriodEnd}</dd></div> : null}
      </dl>
      <section className="mt-6">
        <h2 className={ui.h2}>Earnings</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {model.earnings.map((line) => (
            <li key={line.code} className="flex justify-between"><span>{line.label}</span><span>SGD {line.amountSgd}</span></li>
          ))}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className={ui.h2}>Deductions</h2>
        {model.deductions.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {model.deductions.map((line) => (
              <li key={line.code} className="flex justify-between"><span>{line.label}</span><span>SGD {line.amountSgd}</span></li>
            ))}
          </ul>
        ) : <p className={`mt-2 ${ui.muted}`}>None</p>}
      </section>
      <section className="mt-6">
        <h2 className={ui.h2}>Employer contributions</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {model.employerContributions.map((line) => (
            <li key={line.code} className="flex justify-between"><span>{line.label}</span><span>SGD {line.amountSgd}</span></li>
          ))}
        </ul>
      </section>
      <p className="mt-6 flex justify-between text-base font-semibold">
        <span>Net salary</span>
        <span>SGD {model.netSalary}</span>
      </p>
    </article>
  );
}

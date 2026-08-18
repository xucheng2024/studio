# PAY-03: Itemised payslips and payroll reports

Status: live (`aa67b42` / `060eaf6` / `4c2a69f`; isolated UAT `pay01-payroll-local` run `32098859457`)

## Scope

- MOM itemised payslip view / print / PDF from the locked Finalise snapshot. Never recompute history.
- Freeze `payslip_number` on Finalise.
- Staff see own published slips on My pay. Owner opens any published slip.
- Owner Payroll Summary, Commission Report, and Statutory Contribution Summary, with the existing four-format export.
- Owner or the employee can email the published PDF via studio Resend. Audit records `payslip_number` only, not payroll amounts. Not sent automatically on Finalise.

## Out of scope

IR8A/AIS, GIRO, invented statutory rates, Finalise of real Surgery staff.

## Verification

- Passed: `test:pay03-app`.
- Passed: Free cloud UAT `pay01-payroll-local` https://github.com/xucheng2024/studio/actions/runs/32098859457 — fixture Finalise, MOM payslip fields, instructor own slip, manager denied, reports page, 390×844.
- 2026-08-18: Email PDF on the payslip page (`4c2a69f`). Studio Resend required. No auto-send on Finalise.

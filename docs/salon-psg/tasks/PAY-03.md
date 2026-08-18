# PAY-03: Itemised payslips and payroll reports

Status: live (`aa67b42` / `060eaf6`; isolated UAT `pay01-payroll-local` run `32098859457`)

## Scope

- MOM itemised payslip view / print / PDF from the locked Finalise snapshot. Never recompute history.
- Freeze `payslip_number` on Finalise.
- Staff see own published slips on My pay. Owner opens any published slip.
- Owner Payroll Summary, Commission Report, and Statutory Contribution Summary, with the existing four-format export.
- Audit payslip view and report export without payroll dollar amounts.

## Out of scope

Payslip email, IR8A/AIS, GIRO, invented statutory rates, Finalise of real Surgery staff.

## Verification

- Passed: `test:pay03-app`.
- Passed: Free cloud UAT `pay01-payroll-local` https://github.com/xucheng2024/studio/actions/runs/32098859457 — fixture Finalise, MOM payslip fields, instructor own slip, manager denied, reports page, 390×844.

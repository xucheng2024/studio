# EXP-01: Four-format business export

Status: live (`c012a4e` / `45bc1ea`)

## Scope

Reuse the Deferred CSV/XLSX/XML/TSV builder for Sales, Customers, Packages, and Payroll/Commission. Page filters and roles apply. Sensitive health/NRIC/bank fields stay out. Row caps stay at 5000/2000.

## Out of scope

Async large-file jobs, a second export service, dumping arbitrary tables, bypassing payroll or health permissions.

## Verification

- Passed: `test:exp01-app`.
- Production reports/clients/packages show four-format links. Payroll/Commission keep `/api/payroll/reports/export` (owner only).
- No dedicated export Free cloud UAT. Application screenshots remain for PSG-01.

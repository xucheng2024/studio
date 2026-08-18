# EXP-01: Four-format business export

Status: in progress

## Scope

Reuse the Deferred CSV/XLSX/XML/TSV builder for Sales, Customers, Packages, and Payroll/Commission. Page filters and roles apply. Sensitive health/NRIC/bank fields stay out. Row caps stay at 5000/2000.

## Out of scope

Async large-file jobs, a second export service, dumping arbitrary tables, bypassing payroll or health permissions.

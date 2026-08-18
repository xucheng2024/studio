# RPT-01: Salon reporting facts

Status: live (`571563d` / `b1b7acd`; linked migrations through `20260818200000`)

## Scope

Reuse existing Revenue Summary, Deferred Value RPC, and Commission Entry. Add database aggregates for Appointment Outcome, Service/Retail/YoY sales, Customer Retention/FOV, and Employee Productivity. Location totals must equal All locations; unassigned history is its own row. Do not use a 5,000-row client limit for these facts.

## Out of scope

Chart UI (RPT-02), four-format export expansion (EXP-01), inventory/loyalty numbers, redefining appointment/payment/commission states.

## Verification

- Passed: `test:rpt01-app`.
- Linked Studio: `get_rpt01_reporting_facts` returns JSON. Surgery 2026-08 is empty (0 payments, 0 appointments). Production Owner reports Salon facts load as empty states, not an RPC error.
- No dedicated reports Free cloud UAT. No invented Surgery sales data.

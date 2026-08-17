---
name: studio-local-uat
description: Run, debug, or add isolated local browser UAT and combined Supabase contract-plus-browser verification for the Studio repository. Use when working with `uat.flows.json`, `scripts/run-*-uat-local.mjs`, local Supabase fixtures, database state-machine verification, browser verification, or full local migration-reset verification; never use it for remote or production UAT.
---

# Studio Local UAT

Use this project skill with `$uat-browser` for Studio browser/UAT work. Keep all app, auth, and database targets on loopback addresses.

## Select a flow

- Read `uat.flows.json` before choosing a command. Treat the selected flow as discovery: inspect its verifier, fixture writes, authentication, and server lifecycle before running it.
- Run existing flows through `run_flow.py` from `$uat-browser`; preserve its evidence directory and contract validation.
- Do not edit `uat.flows.json` for an ordinary UAT run. Update it only when adding or maintaining a flow, and include every wrapper/verifier path.

## Use local fixtures safely

- Reuse `scripts/lib/local-supabase-uat.mjs`, `scripts/lib/local-uat-safety.mjs`, and `scripts/lib/local-fixture-auth.mjs`; do not add a second local-target or Auth-session implementation.
- Generate canonical UUID v4 fixture IDs. In `psql` scripts, pass values through `set_config`/`current_setting` instead of attempting variable interpolation inside `DO $$` blocks.
- Keep fixture data isolated and deterministically clean it up. Never use real users, remote Supabase endpoints, or a production fallback.
- Scope Playwright locators to the intended form, dialog, or row whenever labels may repeat.

## Verify the flow

- Assert a user-visible result, authorization/negative path where applicable, relevant database state, and mobile layout at `390x844`.
- Record browser screenshots only when they add useful evidence; automated assertions are the primary result.
- Do not use broad exploratory browser clicking. Inspect the failing flow only.

## Combine database and browser evidence

Use this sequence when a change spans a Supabase migration or RPC state machine and a user-visible flow:

1. Select the closest existing transaction-scoped database verifier for the changed feature. Inspect its target, writes, and cleanup; require a loopback database plus `BEGIN`/`ROLLBACK` or deterministic fixture cleanup.
2. Run the database verifier first to check state transitions, idempotency, concurrency claims, retries, and webhook/event effects relevant to the change.
3. Select the matching `uat.flows.json` entry and run it through `$uat-browser` for the user-visible result, authorization path, database observation, and mobile layout.
4. Report database and browser outcomes separately. Neither result substitutes for the other, and browser cleanup must still complete after a passing run.

Do not use hand-selected migration line ranges or partial migration replay as final proof. Use a focused transaction verifier for behavior and the non-destructive migration replay check for migration ordering. If either database or browser coverage is missing, report the gap; add a verifier or flow only when the task authorizes test maintenance.

## Verify local migration replay

- Run `npm run verify:local-migration-reset` for a non-destructive check of the currently running local Supabase database.
- Run `npm run verify:local-migration-reset:apply` only with explicit authority: it runs `supabase db reset --local --no-seed` and deletes local database data.
- The verifier rejects non-loopback Supabase status, checks the newest migration version, and confirms stable schema anchors. It never targets a remote database.

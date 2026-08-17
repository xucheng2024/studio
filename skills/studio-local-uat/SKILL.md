---
name: studio-local-uat
description: Run, debug, or add isolated local browser UAT and combined Supabase contract-plus-browser verification for the Studio repository. Use when working with `uat.flows.json`, `scripts/run-*-uat-local.mjs`, local Supabase fixtures, database state-machine verification, browser verification, or full local migration-reset verification; never use it for remote or production UAT.
---

# Studio Local UAT

Use this project skill with `$uat-browser` for Studio browser/UAT work. Keep all app, auth, and database targets on loopback addresses.

## Studio cloud adapter

Use `$uat-browser` for generic cloud-hosted routing, caching, batching, concurrency, and minute-usage decisions. This skill owns only Studio-specific declarations: `uat.flows.json`, `scripts/select-cloud-uat-flow.mjs`, `.github/workflows/fast-changed-path-checks.yml`, and `.github/workflows/free-cloud-uat.yml`.

For a normal Studio change, run the changed-path selector first and keep Docker UAT explicit. Use `all` for parallel feedback and `all-batched` only after preserving the audited fixture order in `scripts/run-github-hosted-uat.mjs`.

### Docker execution fail-over

Studio's first-release Docker UAT path is **GitHub Actions Free cloud UAT**, not a developer laptop.

1. Prefer `gh workflow run "Free cloud UAT" -f flow=<flow-id>` (or the Actions UI) for any flow that declares Docker/Supabase lifecycle.
2. Local `$uat-browser` `run_flow.py` is optional when the workstation already has Docker and local Supabase.
3. If `run_flow.py` fails with missing `docker`, unavailable Docker daemon, or equivalent local-environment requirements, **do not treat that as product failure**. Switch immediately to Free cloud UAT for the selected flow. Do not ask the user to install Docker first unless they explicitly want a local runner.
4. When adding a new isolated browser flow, run `node scripts/scaffold-isolated-uat-flow.mjs --id <slug>-local --after <existing-flow-id> --fast-script <existing-npm-script> --write`. It wires `uat.flows.json`, `FAST_SCRIPTS`, Free cloud UAT, release-gate, the routing test catalog, and fixture stubs. Fill the generated verifier assertions, then run `npm run test:cloud-uat-options`. That check is the catalog source of truth: batched GitHub UAT reads `CLOUD_UAT_FLOW_ORDER`, and Free cloud UAT / release-gate lists must match it. A flow that exists only in `uat.flows.json` is not cloud-executable.
5. After that flow passes and the task is closed, read `$workflow-saver` once and screen in silence. Repeated fixture/runner/catalog wiring across flows is valid evidence. Do not skip this screen because validation already passed.

## Select a flow

- Read `uat.flows.json` before choosing a command. Treat the selected flow as discovery: inspect its verifier, fixture writes, authentication, and server lifecycle before running it.
- Run existing flows through `run_flow.py` from `$uat-browser` only when local Docker is available; otherwise use Free cloud UAT. Preserve evidence-directory and contract validation on either path.
- Do not edit `uat.flows.json` for an ordinary UAT run. To add a flow, use `scripts/scaffold-isolated-uat-flow.mjs` and include every wrapper/verifier path plus the cloud catalog wiring above.

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
3. Select the matching `uat.flows.json` entry and run it through Free cloud UAT (preferred) or local `$uat-browser` when Docker is available.
4. Report database and browser outcomes separately. Neither result substitutes for the other, and browser cleanup must still complete after a passing run.

Do not use hand-selected migration line ranges or partial migration replay as final proof. Use a focused transaction verifier for behavior and the non-destructive migration replay check for migration ordering. If either database or browser coverage is missing, report the gap; add a verifier or flow only when the task authorizes test maintenance.

## Verify local migration replay

- Run `npm run verify:local-migration-reset` for a non-destructive check of the currently running local Supabase database.
- Run `npm run verify:local-migration-reset:apply` only with explicit authority: it runs `supabase db reset --local --no-seed` and deletes local database data.
- The verifier rejects non-loopback Supabase status, checks the newest migration version, and confirms stable schema anchors. It never targets a remote database.

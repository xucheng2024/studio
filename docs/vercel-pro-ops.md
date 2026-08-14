# Vercel Pro operations checklist

Use this after enabling Vercel Pro to confirm the deployment is healthier and worth the plan cost.

## Console setup (no code)

1. **Functions region** — Project → Settings → Functions: pick the region closest to your Supabase project (e.g. Singapore for `ap-southeast-1`).
2. **Fluid Compute** — Enable if available on the project for better Serverless concurrency and cold starts.
3. **Speed Insights / Web Analytics** — Enable under the project Observability tabs; establish baselines for LCP and TTFB.
4. **Cron** — After deploy, Project → Settings → Cron Jobs should list `/api/cron/expire-payments` (every 5 minutes) and `/api/cron/pkg02-ops-checks` (every 30 minutes). Requires `CRON_SECRET` in Production env.
5. **Supabase pooler** — In Supabase → Database → Connection string, use the **Transaction** pooler URI for server-side env on Vercel (reduces connection exhaustion on Free tier). Keep direct URL for migrations only.

## Required env (Production)

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Random string; Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` |
| `OPS_ALERT_SLACK_WEBHOOK_URL` | Slack incoming webhook for PKG-02 ops anomaly alerts |
| `PKG02_OPS_STUDIO_ID` (optional) | Restrict PKG-02 ops checks to one studio |
| `PKG02_OPS_LOCATION_ID` (optional) | Restrict PKG-02 ops checks to one location (with studio scope) |
| `PKG02_APPROVED_BACKLOG_ALERT_THRESHOLD` (optional) | Alert threshold for approved-but-not-applied backlog (default `20`) |
| Existing Supabase vars | Unchanged |

## Metrics to compare (before vs after, ~1 week)

### Vercel

- Serverless **Invocations** (total and per route)
- **ISR** reads/writes on `/[studioSlug]`
- Function **duration P95** for:
  - `/[studioSlug]`
  - `/dashboard/*`
  - `/api/operations/queue`
  - `/api/cron/expire-payments`
  - `/api/cron/pkg02-ops-checks`

### Supabase

- **Database connections** (peak)
- **API requests**
- **RPC** calls to `expire_pending_payments` — should drop sharply once Cron runs and layout no longer sweeps on page views

## What we changed in code

- **Cron** [`/api/cron/expire-payments`](../src/app/api/cron/expire-payments/route.ts) replaces per-page payment expiry sweep on studio public layout.
- **Cron** [`/api/cron/pkg02-ops-checks`](../src/app/api/cron/pkg02-ops-checks/route.ts) runs PKG-02 maker/checker guardrail checks, persists results in `public.pkg02_ops_check_runs`, and posts to Slack only when thresholds fail.
- **Data Cache** — Studio landing + layout meta cached 60s with `revalidateTag('studio-public-{slug}')` on dashboard saves.
- **RBAC cache** — `revalidateTag('rbac-access-context')` on staff/owner grant mutations.

## Manual smoke tests

1. Edit public profile → studio home updates within ~60s (or immediately after save via tag).
2. Add/remove staff → dashboard nav/access updates without waiting 30s (after tag revalidation).
3. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/expire-payments` → `{ "ok": true, "expired": N }`.
4. PKG-02 ops: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/pkg02-ops-checks?dry_run=1"` → returns check summary/samples without sending Slack.

## PKG-02 anomaly alert drill (with rollback)

Use this drill to verify end-to-end alert delivery (`notify_status=sent`) and ensure Slack text includes `run_detail` URL.

1. **Prepare one temporary anomaly row** in `pkg02_adjustment_requests` under a test studio scope.
   - Set `status=approved`, valid `submitted_at` + `approved_at`, and add a unique reason tag (for example `ops-alert-drill-<timestamp>`).
   - Keep this drill row isolated and easy to clean up.
2. **Run cron with a strict threshold** (avoid `0` because `pkg02_ops_check_runs.backlog_threshold_hours` must be `> 0`).
   - Example: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/pkg02-ops-checks?studio_id=<test_studio_id>&backlog_threshold=1"`
3. **Verify API response**
   - `run_log.run_id` is present
   - `run_log.run_detail_url` is present
   - `notify.status` is `sent`
   - `approved_not_applied_backlog.result` is `fail`
4. **Verify Slack payload**
   - Alert contains a `run_detail` line with the exact detail URL
   - URL opens `/dashboard/operations/pkg02-checks/<run_id>` in the same scope
5. **Verify persisted run row** in `pkg02_ops_check_runs`
   - `notify_status=sent`
   - `notify_reason is null`
6. **Rollback drill data**
   - Delete temporary `pkg02_adjustment_requests` rows by the unique reason tag.
   - Delete temporary `pkg02_ops_check_runs` rows created by the drill run id(s).
   - Confirm normal cron results return to baseline.

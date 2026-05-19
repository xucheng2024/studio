# Vercel Pro operations checklist

Use this after enabling Vercel Pro to confirm the deployment is healthier and worth the plan cost.

## Console setup (no code)

1. **Functions region** — Project → Settings → Functions: pick the region closest to your Supabase project (e.g. Singapore for `ap-southeast-1`).
2. **Fluid Compute** — Enable if available on the project for better Serverless concurrency and cold starts.
3. **Speed Insights / Web Analytics** — Enable under the project Observability tabs; establish baselines for LCP and TTFB.
4. **Cron** — After deploy, Project → Settings → Cron Jobs should list `/api/cron/expire-payments` (every 5 minutes). Requires `CRON_SECRET` in Production env.
5. **Supabase pooler** — In Supabase → Database → Connection string, use the **Transaction** pooler URI for server-side env on Vercel (reduces connection exhaustion on Free tier). Keep direct URL for migrations only.

## Required env (Production)

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Random string; Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` |
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

### Supabase

- **Database connections** (peak)
- **API requests**
- **RPC** calls to `expire_pending_payments` — should drop sharply once Cron runs and layout no longer sweeps on page views

## What we changed in code

- **Cron** [`/api/cron/expire-payments`](../src/app/api/cron/expire-payments/route.ts) replaces per-page payment expiry sweep on studio public layout.
- **Data Cache** — Studio landing + layout meta cached 60s with `revalidateTag('studio-public-{slug}')` on dashboard saves.
- **RBAC cache** — `revalidateTag('rbac-access-context')` on staff/owner grant mutations.

## Manual smoke tests

1. Edit public profile → studio home updates within ~60s (or immediately after save via tag).
2. Add/remove staff → dashboard nav/access updates without waiting 30s (after tag revalidation).
3. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/expire-payments` → `{ "ok": true, "expired": N }`.

# Studio - Gym & Studio Bookings (MVP)

Studio is a booking and operations app for gyms and class-based studios. It includes a public booking flow, dashboard management, check-in, payments, and reporting.

## What exists in this repo

- Public booking pages (`/booking/[slug]`, `/class/[studioSlug]/[classSlug]`)
- Checkout pages (`/checkout`, `/checkout/[payment_id]`, `/buy/[studioSlug]/[packageSlug]`)
- Dashboard modules for classes, sessions, clients, packages, payments, reports, staff, settings
- API routes for booking, package usage, payment confirmation, check-in, frontdesk walk-in, exports, and invoice sending
- HitPay webhook endpoint (`/api/payment/hitpay/webhook`)

All studio catalog pricing and HitPay charges are **SGD only**.

## Tech stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Supabase (Auth, Postgres, RLS, RPC)
- Tailwind CSS v4
- HitPay integration (per-studio merchant keys)
- Resend email (per-studio API keys for tenant mail; platform `RESEND_*` is not a tenant fallback)

## Project structure

- `src/app` - App Router pages and API routes
- `src/components` - UI and feature components
- `src/lib` - shared domain logic (Supabase, auth helpers, payments, etc.)
- `supabase/migrations` - SQL migrations (baseline + incremental migrations)
- `scripts` - utility scripts
- `docs` - internal project docs

## Environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)

Optional (if used by your environment):

- `RESEND_API_KEY` (platform-owned mail only, e.g. contact form; studio campaigns/notifications use dashboard Email settings)
- `SUPER_ADMIN_EMAILS`
- `HITPAY_API_BASE_URL`

## Local setup

1. Create a Supabase project.
2. Apply migrations from `supabase/migrations`:
   - For fresh environments, start from the baseline file currently in the folder.
   - For ongoing development, add new incremental migration files after the baseline.
3. In Supabase Auth providers, enable Email (password) sign-in.
4. Install and run:

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test:revenue
```

## Local UAT

Run the isolated APT-04 browser UAT against Docker-backed local Supabase:

```bash
npm run test:local-uat
```

The script injects local Supabase credentials only into its child processes, starts Next.js on port `3104`, waits for it, runs Chrome by default, then stops that server. It does not write local credentials to an env file. Pass `--engines` or `--port` after `--` when needed.

`uat.flows.json` maps changed project paths to existing UAT commands. It is a selection aid only: it never executes a command or authorizes tests that write data.

To run without local Docker, view the first-release free cloud recommendation:

```bash
npm run uat:cloud-options
```

GitHub Actions is the only first-release recommendation. See [Free cloud UAT](docs/free-cloud-uat.md) for the reasons and limits.

```bash
python3 /Users/mac/.codex-azure/skills/uat-browser/scripts/select_flow.py \
  --cwd "$PWD" --changed-path 'src/app/(app)/dashboard/clients/page.tsx'
```

## HitPay setup

1. Configure per-studio HitPay settings from dashboard payment settings.
2. In HitPay dashboard, set webhook URL:
   - `https://<your-domain>/api/payment/hitpay/webhook`
3. Subscribe to payment/refund updates.
4. Keep webhook salt aligned with the value configured in the app.

## Deploy (GitHub -> Vercel)

1. Push repo to GitHub.
2. Import project in Vercel.
3. Configure env vars with the same names as `.env.local`.
4. Set `CRON_SECRET` in Production (random string) for `/api/cron/expire-payments` (see `vercel.json`).
5. Redeploy after saving env vars.

### Vercel Pro (recommended)

See [docs/vercel-pro-ops.md](docs/vercel-pro-ops.md) for:

- Function region alignment with Supabase
- Fluid Compute, Speed Insights, Web Analytics
- Supabase transaction pooler for serverless
- Metrics to verify lower invocations and RPC usage

## Troubleshooting

- Routes fail while homepage loads: check missing Supabase public env vars.
- API permission errors: verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly and used server-side only.
- HitPay webhook failures: verify URL, subscribed events, and webhook salt.

## Security notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client-side code.
- Rotate payment and email secrets periodically.

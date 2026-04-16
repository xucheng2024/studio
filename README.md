# Studio — gym & studio bookings (MVP)

Next.js (App Router) + Supabase (Auth, Postgres, RLS) + optional Resend emails. Payments use a PayNow QR + manual confirmation MVP flow.

## Setup

1. Create a Supabase project and run migrations in order: `001_initial.sql`, `002_qr_slug_guest_booking.sql`, `003_book_session_studio_scope.sql`, `004_studios_rls_owner_role.sql`, `005_paynow_flow.sql`, `006_multi_location_rules_rbac.sql`, `007_booking_rule_engine.sql`, `008_booking_rules_no_show_buffer.sql`, `009_payment_confirmation_split.sql`, `010_guest_merge_and_ops_audit.sql`, `011_booking_notification_fields.sql`, `012_scope_checkin_credit_and_walkin.sql`, `013_checkin_package_anti_abuse_recon.sql`, `014_studio_paynow_settings.sql` (SQL editor or Supabase CLI).
2. In Supabase **Authentication → Providers**, enable Email (password). Confirm signups in development if email confirmation is on.
3. Copy `.env.example` to `.env.local`. In **Project Settings → API**, set `NEXT_PUBLIC_SUPABASE_URL`, then either **`anon` `public`** (JWT) as `NEXT_PUBLIC_SUPABASE_ANON_KEY` **or** the **publishable** key as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. You must also set **`service_role`** (server-only) as `SUPABASE_SERVICE_ROLE_KEY` for booking APIs and RPCs — never expose it in the browser.

## Local dev

```bash
npm install
npm run dev
```

## Deploy (GitHub → Vercel)

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. **Required —** in **Vercel → Project → Settings → Environment Variables**, add (same names as local `.env.local`; see `.env.example`):

   | Name | Notes |
   |------|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase **API** settings |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` **or** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public anon / publishable key (not the `service_role` key) |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Secret** — server-only; required for booking, payments, dashboard data |

   Apply to **Production** (and Preview if you test PRs against a real DB). Redeploy after saving env vars.

4. Optional cron: call `GET /api/payment/expire` every minute, `GET /api/no-show/process` every 1-5 minutes, and `GET /api/reminder/send` every 5 minutes with `Authorization: Bearer <CRON_SECRET>`.
5. Optional cron alerting: set `CRON_ALERT_WEBHOOK_URL` for failure notifications.

If the homepage loads but other routes fail, the public Supabase keys are usually missing or only set for one environment (e.g. Development but not Production).

## Flow

- **Owner**: sign up with role `Studio owner`, create a studio (name + **public URL slug**) on `/dashboard`, add classes, schedule sessions, packages. Open **Dashboard → QR code** for the printable link and QR (`/booking/your-slug`).
- **Client (QR)**: scan QR → `/booking/<slug>` → pick a class → **Book** → enter name + email → `/checkout/<payment_id>` → scan PayNow QR → click **I have paid**.
- **Guest merge**: when a user account is created/updated with an email, guest bookings/payments with matching normalized email are auto-linked to that user (`merge_guest_records_for_user`).
- **Client (signed in)**: buy a pack or drop-in on `/checkout`, then either `Book with package` (`/api/book/package`) or create a paynow booking (`/api/book/create`).
- **Credit timing**: booking only reserves spot; package/single credit is consumed at check-in (or by late-cancel/no-show rules when configured).
- **Owner verification**: `/dashboard/payments` lists pending/paid/expired, includes pending-review filter/SLA, and actions to mark paid/failed/expired.
- **Notifications**: payment submitted notifies owner/frontdesk recipients; payment verdict notifies client/guest; late-cancel and no-show outcomes notify client/guest; reminders run via cron endpoint.

API routes use the service role and Postgres RPCs (`confirm_paynow_payment`, `expire_pending_payments`) for payment state transitions.

## Rollback Notes

- App code can be rolled back independently.
- DB migrations are additive; for emergency rollback prefer feature flags / route disable over dropping columns/tables.
- If needed, disable cron endpoints first, then roll back app deploy.

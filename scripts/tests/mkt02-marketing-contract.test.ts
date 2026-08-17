import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isAllowedMarketingCtaUrl } from "../../src/lib/marketing-url.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("MKT-02 dispatch uses durable claims and a stable Resend idempotency key", () => {
  const migration = read("supabase/migrations/20260817150000_mkt02_campaign_dispatch_reporting.sql");
  const dispatch = read("src/lib/marketing-dispatch.ts");
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /dispatch_batch_id/);
  assert.match(migration, /p_stale_after_seconds/);
  assert.match(dispatch, /idempotencyKey: `mkt02\/\$\{rows\[0\]\.dispatch_batch_id\}`/);
  assert.match(dispatch, /resend\.batch\.send/);
  assert.doesNotMatch(dispatch, /\bbcc\s*:/i);
});

test("MKT-02 Resend webhook verifies the raw body before provider-event dedup", () => {
  const webhook = read("src/app/api/webhooks/resend/[studioId]/route.ts");
  assert.ok(webhook.indexOf("await request.text()") < webhook.indexOf("verifyResendWebhook(rawBody"));
  assert.ok(webhook.indexOf("verifyResendWebhook(rawBody") < webhook.indexOf("claimProviderEvent({"));
  assert.match(webhook, /invalid_signature/);
  assert.match(webhook, /hashProviderPayload\(rawBody\)/);
  assert.match(webhook, /getStudioResendSecrets\(studioId\)/);
  assert.match(webhook, /recipient\.studio_id !== studioId/);
});

test("MKT-02 dispatch uses the studio Resend account and does not fall back to platform keys", () => {
  const dispatch = read("src/lib/marketing-dispatch.ts");
  assert.match(dispatch, /getStudioResendSendConfig\(studioId\)/);
  assert.doesNotMatch(dispatch, /process\.env\.RESEND_API_KEY/);
  assert.doesNotMatch(dispatch, /process\.env\.RESEND_FROM_EMAIL/);
  assert.doesNotMatch(dispatch, /process\.env\.RESEND_WEBHOOK_SECRET/);
});

test("MKT-02 evidence tables remain server-only and clicks reject unsafe redirects", () => {
  const migration = read("supabase/migrations/20260817150000_mkt02_campaign_dispatch_reporting.sql");
  const clickRoute = read("src/app/r/c/[token]/route.ts");
  assert.match(migration, /alter table public\.marketing_links enable row level security/);
  assert.match(migration, /revoke all on public\.marketing_links, public\.marketing_campaign_events from public, anon, authenticated/);
  assert.match(migration, /mkt02_validate_evidence_scope/);
  assert.match(clickRoute, /isAllowedMarketingCtaUrl\(result\.target_url\)/);
});

test("MKT-02 CTA redirects use exact configured HTTPS hosts", () => {
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const previousAllowedHosts = process.env.MARKETING_CTA_ALLOWED_HOSTS;
  process.env.NEXT_PUBLIC_APP_URL = "https://studio.example.com";
  process.env.MARKETING_CTA_ALLOWED_HOSTS = "booking.example.com, offers.example.com.";
  try {
    assert.equal(isAllowedMarketingCtaUrl("https://studio.example.com/book"), true);
    assert.equal(isAllowedMarketingCtaUrl("https://booking.example.com/book"), true);
    assert.equal(isAllowedMarketingCtaUrl("https://offers.example.com./book"), true);
    assert.equal(isAllowedMarketingCtaUrl("https://evil.example/book"), false);
    assert.equal(isAllowedMarketingCtaUrl("https://booking.example.com.evil.test/book"), false);
    assert.equal(isAllowedMarketingCtaUrl("https://user@booking.example.com/book"), false);
    assert.equal(isAllowedMarketingCtaUrl("https://booking.example.com:444/book"), false);
    assert.equal(isAllowedMarketingCtaUrl("http://booking.example.com/book"), false);
  } finally {
    if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    if (previousAllowedHosts === undefined) delete process.env.MARKETING_CTA_ALLOWED_HOSTS;
    else process.env.MARKETING_CTA_ALLOWED_HOSTS = previousAllowedHosts;
  }
});

test("MKT-02 does not manually retry unreconciled provider outcomes", () => {
  const migration = read("supabase/migrations/20260817150000_mkt02_campaign_dispatch_reporting.sql");
  const dispatch = read("src/lib/marketing-dispatch.ts");
  assert.match(migration, /last_error is distinct from 'dispatch outcome could not be reconciled'/);
  assert.match(dispatch, /dispatch_failure_update_rejected/);
});

test("studio email secrets are service-role only with RLS and no client policies", () => {
  const schema = read("supabase/migrations/20260818001000_studio_email_secrets.sql");
  assert.match(schema, /create table if not exists public\.studio_email_secrets/);
  assert.match(schema, /alter table public\.studio_email_secrets enable row level security/);
  assert.match(schema, /revoke all on table public\.studio_email_secrets from public/);
  assert.match(schema, /grant all on table public\.studio_email_secrets to service_role/);
  assert.doesNotMatch(schema, /create policy/i);
  assert.match(schema, /add column if not exists resend_enabled boolean not null default false/);
});

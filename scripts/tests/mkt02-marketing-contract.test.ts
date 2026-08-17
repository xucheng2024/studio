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
  const webhook = read("src/app/api/webhooks/resend/route.ts");
  assert.ok(webhook.indexOf("await request.text()") < webhook.indexOf("verifyResendWebhook(rawBody"));
  assert.ok(webhook.indexOf("verifyResendWebhook(rawBody") < webhook.indexOf("claimProviderEvent({"));
  assert.match(webhook, /invalid_signature/);
  assert.match(webhook, /hashProviderPayload\(rawBody\)/);
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

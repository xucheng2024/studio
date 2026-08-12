import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const BASE_URL = process.env.CRM02_BASE_URL || 'https://www.sgmystudio.com';
const SCREEN_DIR = path.join(process.cwd(), 'tmp', 'crm02-playwright');
fs.mkdirSync(SCREEN_DIR, { recursive: true });

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

const env = { ...loadEnv('.env.local'), ...process.env };
const fixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts', 'fixtures', 'crm02-playwright-accounts.json'), 'utf8'),
);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.error('Missing Supabase env values.');
  process.exit(2);
}
const configuredProjectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (configuredProjectRef !== fixture.projectRef) {
  console.error(`CRM-02 fixture belongs to ${fixture.projectRef}, not ${configuredProjectRef}.`);
  process.exit(2);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function unwrap(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${result.error.message} (${result.error.code ?? 'no_code'})`);
  }
  return result.data;
}

const runId = fixture.runId;
const executionId = `${runId}_${Date.now()}`;

async function ensureAuthUser(email, password, userId) {
  const found = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (found.error) throw found.error;
  const existing = found.data.users.find((row) => row.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    const updated = await admin.auth.admin.updateUserById(existing.id, {
      ...(password ? { password } : {}),
      email_confirm: true,
    });
    if (updated.error) throw updated.error;
    return existing.id;
  }
  if (!password) {
    throw new Error(`Missing CRM02_TEST_PASSWORD required to recreate ${email}`);
  }
  const created = await admin.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (created.error) throw created.error;
  return created.data.user.id;
}

async function seedData() {
  const password = env.CRM02_TEST_PASSWORD || null;
  const studioId = fixture.studioId;
  const l1 = fixture.locations.l1;
  const l2 = fixture.locations.l2;
  const users = structuredClone(fixture.users);

  for (const role of Object.values(users)) {
    role.authId = await ensureAuthUser(role.email, password, role.id);
  }

  unwrap(
    await admin.from('users').upsert(Object.values(users).map((row) => ({ id: row.authId, email: row.email })), { onConflict: 'id' }),
    'users upsert',
  );

  unwrap(
    await admin.from('user_profiles').upsert(
      Object.values(users).map((row) => ({
        id: row.authId,
        email: row.email,
        full_name: row.email.split('@')[0],
        role: 'member',
      })),
      { onConflict: 'id' },
    ),
    'user_profiles upsert',
  );

  unwrap(
    await admin.from('studios').upsert({
      id: studioId,
      owner_id: users.owner.authId,
      name: `CRM02 PW ${runId}`,
      public_slug: `${runId}`.slice(0, 50),
      contract_status: 'active',
    }, { onConflict: 'id' }),
    'studios upsert',
  );

  unwrap(
    await admin.from('locations').upsert([
      { id: l1, studio_id: studioId, name: `L1 ${runId}`, is_active: true },
      { id: l2, studio_id: studioId, name: `L2 ${runId}`, is_active: true },
    ], { onConflict: 'id' }),
    'locations upsert',
  );

  const serviceId = fixture.serviceId;
  unwrap(
    await admin.from('studio_services').upsert({
      id: serviceId,
      studio_id: studioId,
      title: `Service ${runId}`,
      price: 120,
      currency: 'SGD',
      is_active: true,
      default_duration_minutes: 60,
      default_prep_minutes: 10,
      default_buffer_minutes: 10,
    }, { onConflict: 'id' }),
    'studio_services upsert',
  );

  unwrap(
    await admin.from('service_locations').upsert([
      { studio_id: studioId, service_id: serviceId, location_id: l1, is_enabled: true, uses_default_values: true },
      { studio_id: studioId, service_id: serviceId, location_id: l2, is_enabled: true, uses_default_values: true },
    ], { onConflict: 'service_id,location_id' }),
    'service_locations upsert',
  );

  const employees = fixture.employees;

  unwrap(
    await admin.from('employees').upsert([
      { id: employees.eL1, studio_id: studioId, user_id: users.instructorL1.authId, display_name: `Inst L1 ${runId}`, employment_status: 'active' },
      { id: employees.eL2, studio_id: studioId, user_id: users.instructorL2.authId, display_name: `Inst L2 ${runId}`, employment_status: 'active' },
      { id: employees.eMixed, studio_id: studioId, user_id: users.mixed.authId, display_name: `Inst Mixed ${runId}`, employment_status: 'active' },
    ], { onConflict: 'id' }),
    'employees upsert',
  );

  unwrap(
    await admin.from('employee_locations').upsert([
      { employee_id: employees.eL1, location_id: l1, studio_id: studioId, is_primary: true, is_active: true },
      { employee_id: employees.eL2, location_id: l2, studio_id: studioId, is_primary: true, is_active: true },
      { employee_id: employees.eMixed, location_id: l2, studio_id: studioId, is_primary: true, is_active: true },
    ]),
    'employee_locations upsert',
  );

  unwrap(
    await admin.from('service_employees').upsert([
      { studio_id: studioId, service_id: serviceId, employee_id: employees.eL1, is_active: true },
      { studio_id: studioId, service_id: serviceId, employee_id: employees.eL2, is_active: true },
      { studio_id: studioId, service_id: serviceId, employee_id: employees.eMixed, is_active: true },
    ], { onConflict: 'service_id,employee_id' }),
    'service_employees upsert',
  );

  unwrap(
    await admin.from('staff_memberships').upsert([
      { id: fixture.memberships.managerGlobal, user_id: users.managerGlobal.authId, studio_id: studioId, location_id: null, role: 'manager', is_active: true },
      { id: fixture.memberships.managerL1, user_id: users.managerL1.authId, studio_id: studioId, location_id: l1, role: 'manager', is_active: true },
      { id: fixture.memberships.frontdeskL1, user_id: users.frontdeskL1.authId, studio_id: studioId, location_id: l1, role: 'frontdesk', is_active: true },
      { id: fixture.memberships.instructorL1, user_id: users.instructorL1.authId, studio_id: studioId, location_id: l1, role: 'instructor', is_active: true },
      { id: fixture.memberships.instructorL2, user_id: users.instructorL2.authId, studio_id: studioId, location_id: l2, role: 'instructor', is_active: true },
      { id: fixture.memberships.mixedManagerL1, user_id: users.mixed.authId, studio_id: studioId, location_id: l1, role: 'manager', is_active: true },
      { id: fixture.memberships.mixedInstructorL2, user_id: users.mixed.authId, studio_id: studioId, location_id: l2, role: 'instructor', is_active: true },
    ], { onConflict: 'id' }),
    'staff_memberships upsert',
  );

  const customerId = fixture.customerId;
  unwrap(
    await admin.from('salon_customers').upsert({
      id: customerId,
      studio_id: studioId,
      full_name: `PW Customer ${runId}`,
      email: `${runId}.customer@example.com`,
      status: 'active',
      source: 'frontdesk',
    }, { onConflict: 'id' }),
    'salon_customers upsert',
  );

  const now = new Date();
  const toIso = (d) => d.toISOString();
  const minusDays = (days) => new Date(now.getTime() - days * 24 * 3600 * 1000);
  const plusDays = (days) => new Date(now.getTime() + days * 24 * 3600 * 1000);

  const aptL1Completed = fixture.appointments.l1Completed;
  const aptL2Completed = fixture.appointments.l2Completed;
  const aptL1Confirmed = fixture.appointments.l1Confirmed;

  const makeApt = (idv, locationId, employeeId, status, start) => ({
    id: idv,
    studio_id: studioId,
    location_id: locationId,
    salon_customer_id: customerId,
    service_id: serviceId,
    employee_id: employeeId,
    status,
    starts_at: toIso(start),
    ends_at: toIso(new Date(start.getTime() + 60 * 60 * 1000)),
    occupied_from: toIso(new Date(start.getTime() - 10 * 60 * 1000)),
    occupied_until: toIso(new Date(start.getTime() + 70 * 60 * 1000)),
    service_title_snapshot: `Service ${runId}`,
    service_price_snapshot: 120,
    service_currency_snapshot: 'SGD',
    service_duration_snapshot_minutes: 60,
    prep_snapshot_minutes: 10,
    buffer_snapshot_minutes: 10,
    employee_name_snapshot: employeeId === employees.eL1 ? `Inst L1 ${runId}` : `Inst L2 ${runId}`,
    location_name_snapshot: locationId === l1 ? `L1 ${runId}` : `L2 ${runId}`,
    created_by: users.managerGlobal.authId,
    updated_by: users.managerGlobal.authId,
  });

  unwrap(
    await admin.from('salon_appointments').upsert([
      makeApt(aptL1Completed, l1, employees.eL1, 'completed', minusDays(2)),
      makeApt(aptL2Completed, l2, employees.eL2, 'completed', minusDays(1)),
      makeApt(aptL1Confirmed, l1, employees.eL1, 'confirmed', plusDays(1)),
    ], { onConflict: 'id' }),
    'salon_appointments upsert',
  );

  // Seed one treatment + one overdue follow-up via CRM-02 RPC with idempotency.
  const cc = unwrap(await admin.rpc('claim_business_idempotency_key', {
    p_studio_id: studioId,
    p_operation_scope: 'salon_treatment:create_from_appointment',
    p_idempotency_key: `${runId}:create:l1`,
    p_request_hash: 'a'.repeat(64),
    p_stale_after_seconds: 300,
  }), 'claim create:l1');

  if (cc.outcome === 'claimed') {
    unwrap(await admin.rpc('crm02_create_or_link_treatment_from_appointment', {
      p_actor_id: users.managerGlobal.authId,
      p_actor_role: 'manager',
      p_actor_employee_id: null,
      p_studio_id: studioId,
      p_appointment_id: aptL1Completed,
      p_actual_employee_id: null,
      p_lifecycle_status: 'open',
      p_revision_reason: `${runId}:initial`,
      p_note_summary: `${runId}:summary`,
      p_sensitive_note_body: `${runId}:SENSITIVE_BODY`,
      p_follow_up_due_on: toIso(minusDays(1)).slice(0, 10),
      p_follow_up_owner_employee_id: employees.eL1,
      p_follow_up_note_summary: `${runId}:followup`,
      p_idempotency_key_id: cc.id,
      p_idempotency_claim_token: cc.claimToken,
    }), 'create_or_link treatment:l1');
  } else if (cc.outcome !== 'already_completed') {
    throw new Error(`Unexpected reusable fixture claim outcome: ${cc.outcome}`);
  }

  return {
    runId,
    studioId,
    l1,
    l2,
    customerId,
    aptL1Completed,
    aptL2Completed,
    aptL1Confirmed,
    users,
    employees,
  };
}

async function getMagicLink(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${BASE_URL}/post-auth?staff_portal=1`,
    },
  });
  if (error) throw error;
  return data.properties.action_link;
}

async function loginAs(browser, email, label) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const link = await getMagicLink(email);
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SCREEN_DIR, `${label}-after-magic.png`), fullPage: true });
  return { context, page };
}

async function assertVisible(page, text, label) {
  const ok = await page.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (!ok) {
    await page.screenshot({ path: path.join(SCREEN_DIR, `${label}-assert-fail.png`), fullPage: true });
    throw new Error(`Expected text not visible: ${text}`);
  }
}

async function runBrowserValidation(seed) {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  const roleChecks = [
    ['owner', seed.users.owner.email],
    ['manager-global', seed.users.managerGlobal.email],
    ['manager-l1', seed.users.managerL1.email],
    ['frontdesk-l1', seed.users.frontdeskL1.email],
    ['instructor-l1', seed.users.instructorL1.email],
    ['instructor-l2', seed.users.instructorL2.email],
    ['mixed', seed.users.mixed.email],
  ];

  const mustSeeCustomer = new Set(['owner', 'manager-global', 'manager-l1', 'frontdesk-l1', 'instructor-l1', 'mixed']);

  for (const [label, email] of roleChecks) {
    const { context, page } = await loginAs(browser, email, label);
    try {
      await page.goto(`${BASE_URL}/dashboard/clients?studio_id=${seed.studioId}`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SCREEN_DIR, `${label}-clients.png`), fullPage: true });

      const hasCustomer = await page.getByText(`PW Customer ${seed.runId}`).first().isVisible().catch(() => false);
      const expected = mustSeeCustomer.has(label);
      if (expected && !hasCustomer) throw new Error(`Customer row should be visible for ${label}`);
      if (!expected && hasCustomer) throw new Error(`Customer row should NOT be visible for ${label}`);
      if (!expected) {
        results.push({ role: label, ok: true, note: 'no customer visibility as expected' });
        continue;
      }

      await page.getByRole('link', { name: /PW Customer/i }).first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREEN_DIR, `${label}-client-detail.png`), fullPage: true });

      await assertVisible(page, 'Treatments / Follow-up', label);

      if (label === 'instructor-l1' || label === 'mixed') {
        const leakedL2Name = await page.getByText(`Inst L2 ${seed.runId}`).first().isVisible().catch(() => false);
        if (leakedL2Name) {
          throw new Error(`${label} leaked L2 instructor snapshot`);
        }
      }

      // Queue page
      await page.goto(`${BASE_URL}/dashboard/clients/follow-ups?studio_id=${seed.studioId}`, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SCREEN_DIR, `${label}-queue.png`), fullPage: true });
      await assertVisible(page, 'Follow-up queue', label);

      // 390px mobile smoke on owner only
      if (label === 'owner') {
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
        const mp = await mobile.newPage();
        const mlink = await getMagicLink(email);
        await mp.goto(mlink, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await mp.goto(`${BASE_URL}/dashboard/clients/follow-ups?studio_id=${seed.studioId}`, { waitUntil: 'networkidle', timeout: 120000 });
        await mp.waitForTimeout(800);
        const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        await mp.screenshot({ path: path.join(SCREEN_DIR, `owner-mobile-390.png`), fullPage: true });
        await mobile.close();
        if (overflow) throw new Error('390px layout overflow detected');
      }

      results.push({ role: label, ok: true });
    } catch (error) {
      results.push({ role: label, ok: false, error: String(error.message || error) });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  return results;
}

async function runDbAssertions(seed) {
  const findings = [];

  // Uncompleted appointment must fail treatment create.
  const claim = unwrap(await admin.rpc('claim_business_idempotency_key', {
    p_studio_id: seed.studioId,
    p_operation_scope: 'salon_treatment:create_from_appointment',
    p_idempotency_key: `${executionId}:create:uncompleted`,
    p_request_hash: 'b'.repeat(64),
    p_stale_after_seconds: 300,
  }), 'claim create:uncompleted');

  const failCreate = await admin.rpc('crm02_create_or_link_treatment_from_appointment', {
    p_actor_id: seed.users.frontdeskL1.authId,
    p_actor_role: 'frontdesk',
    p_actor_employee_id: null,
    p_studio_id: seed.studioId,
    p_appointment_id: seed.aptL1Confirmed,
    p_actual_employee_id: null,
    p_lifecycle_status: 'open',
    p_revision_reason: 'should_fail',
    p_note_summary: null,
    p_sensitive_note_body: null,
    p_follow_up_due_on: null,
    p_follow_up_owner_employee_id: null,
    p_follow_up_note_summary: null,
    p_idempotency_key_id: claim.id,
    p_idempotency_claim_token: claim.claimToken,
  });
  if (!failCreate.error) throw new Error('Expected uncompleted appointment to fail treatment creation');
  findings.push({ check: 'uncompleted_appointment_blocked', ok: true });

  // Same idempotency key replay should not duplicate.
  const key = `${executionId}:replay:l2`;
  const c1 = unwrap(await admin.rpc('claim_business_idempotency_key', {
    p_studio_id: seed.studioId,
    p_operation_scope: 'salon_treatment:create_from_appointment',
    p_idempotency_key: key,
    p_request_hash: 'c'.repeat(64),
    p_stale_after_seconds: 300,
  }), 'claim replay first');

  unwrap(await admin.rpc('crm02_create_or_link_treatment_from_appointment', {
    p_actor_id: seed.users.managerGlobal.authId,
    p_actor_role: 'manager',
    p_actor_employee_id: null,
    p_studio_id: seed.studioId,
    p_appointment_id: seed.aptL2Completed,
    p_actual_employee_id: null,
    p_lifecycle_status: 'open',
    p_revision_reason: `${executionId}:replay`,
    p_note_summary: null,
    p_sensitive_note_body: `${executionId}:SENSITIVE_REPLAY`,
    p_follow_up_due_on: null,
    p_follow_up_owner_employee_id: null,
    p_follow_up_note_summary: null,
    p_idempotency_key_id: c1.id,
    p_idempotency_claim_token: c1.claimToken,
  }), 'create_or_link replay first');

  const c2 = unwrap(await admin.rpc('claim_business_idempotency_key', {
    p_studio_id: seed.studioId,
    p_operation_scope: 'salon_treatment:create_from_appointment',
    p_idempotency_key: key,
    p_request_hash: 'c'.repeat(64),
    p_stale_after_seconds: 300,
  }), 'claim replay second');
  if (c2.outcome !== 'already_completed') {
    throw new Error(`Expected already_completed, got ${c2.outcome}`);
  }
  findings.push({ check: 'idempotency_replay_no_duplicate', ok: true });

  // Sensitive body must not leak to strong audit.
  const marker = `${executionId}:SENSITIVE`;
  const { data: auditRows, error: leakErr } = await admin
    .from('strong_audit_logs')
    .select('before_state, after_state')
    .eq('studio_id', seed.studioId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (leakErr) throw leakErr;
  const leaked = (auditRows ?? []).some((row) => JSON.stringify(row).includes(marker));
  if (leaked) {
    throw new Error('sensitive_note_body marker leaked into strong_audit_logs');
  }
  findings.push({ check: 'audit_redaction_sensitive_body', ok: true });

  // Follow-up queue due-date ordering + status flow
  const { data: queueRows, error: qErr } = await admin
    .from('salon_treatment_follow_ups')
    .select('id, due_on, status')
    .eq('studio_id', seed.studioId)
    .order('due_on', { ascending: true });
  if (qErr) throw qErr;
  if ((queueRows ?? []).length === 0) throw new Error('No follow-up rows found for queue assertions');
  findings.push({ check: 'followup_queue_has_rows', ok: true });

  return findings;
}

(async () => {
  const report = {
    runId,
    executionId,
    baseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    browser: null,
    db: null,
    ok: false,
  };

  try {
    const seed = await seedData();
    const browser = await runBrowserValidation(seed);
    const db = await runDbAssertions(seed);

    report.browser = browser;
    report.db = db;
    report.ok = browser.every((x) => x.ok) && db.every((x) => x.ok);
  } catch (error) {
    report.error = String(error.message || error);
  }

  report.finishedAt = new Date().toISOString();
  const outPath = path.join(SCREEN_DIR, `report-${executionId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath: outPath, ...report }, null, 2));

  if (!report.ok) process.exit(1);
})();

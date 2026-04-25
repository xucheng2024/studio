import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const CFG = {
  studioId: "16f775db-50ad-4eaa-9f82-2a1f0048cce4",
  locationId: "be01ac30-4c47-4713-af3e-94710e8a64ba",
  classId: "9a44c48b-c384-437b-9bd5-16f2aaa15e5d",
  ownerId: "3127c00a-5e7c-4b0d-a8b2-c05b0d6c7679",
  packageId: "835f7785-b71c-441c-b076-26dfa1aa6b24",
  realMemberId: "f7cdadc7-2fff-4f3f-b10b-13099b2dfd77",
  seedTag: "SEEDM-ANGLE-20260425",
};

const randPwd = () => crypto.randomBytes(16).toString("hex") + "Aa1!";

function atTime(baseDate, hour, minute = 0) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function iso(d) {
  return d.toISOString();
}

async function ensureUserByEmail(email, fullName, phone) {
  const normalized = email.trim().toLowerCase();
  const { data: existingUserRow, error: findErr } = await admin
    .from("users")
    .select("id, email")
    .eq("email", normalized)
    .maybeSingle();
  if (findErr) throw findErr;

  let userId = existingUserRow?.id ?? null;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: normalized,
      password: randPwd(),
      email_confirm: true,
      user_metadata: { full_name: fullName, phone, role: "client" },
    });
    if (error) {
      const { data: again, error: againErr } = await admin
        .from("users")
        .select("id")
        .eq("email", normalized)
        .maybeSingle();
      if (againErr || !again?.id) throw error;
      userId = again.id;
    } else {
      userId = data.user?.id ?? null;
      if (!userId) throw new Error(`createUser returned no id for ${normalized}`);
    }
  }

  const { error: upUsersErr } = await admin
    .from("users")
    .upsert({ id: userId, email: normalized }, { onConflict: "id" });
  if (upUsersErr) throw upUsersErr;

  const { error: upProfileErr } = await admin.from("user_profiles").upsert(
    { id: userId, email: normalized, full_name: fullName, phone, role: "client" },
    { onConflict: "id" },
  );
  if (upProfileErr) throw upProfileErr;

  return userId;
}

async function cleanupSeedRows() {
  const likeTag = `${CFG.seedTag}%`;

  const { data: sessionRows, error: sErr } = await admin
    .from("class_sessions")
    .select("id")
    .eq("class_id", CFG.classId)
    .like("share_slug", likeTag);
  if (sErr) throw sErr;
  const sessionIds = (sessionRows ?? []).map((r) => r.id);

  const { error: pErr } = await admin
    .from("payments")
    .delete()
    .eq("studio_id", CFG.studioId)
    .like("reference_code", likeTag);
  if (pErr) throw pErr;

  if (sessionIds.length > 0) {
    const { error: bErr } = await admin.from("bookings").delete().in("session_id", sessionIds);
    if (bErr) throw bErr;
  }

  const { error: csErr } = await admin
    .from("class_sessions")
    .delete()
    .eq("class_id", CFG.classId)
    .like("share_slug", likeTag);
  if (csErr) throw csErr;
}

async function main() {
  // 0) read class/package metadata
  const [{ data: cls, error: classErr }, { data: pkg, error: pkgErr }] = await Promise.all([
    admin.from("classes").select("id, capacity, duration_min, title").eq("id", CFG.classId).single(),
    admin.from("packages").select("id, credits, price, name").eq("id", CFG.packageId).single(),
  ]);
  if (classErr || !cls) throw classErr ?? new Error("class not found");
  if (pkgErr || !pkg) throw pkgErr ?? new Error("package not found");

  await cleanupSeedRows();

  // 1) create/ensure 20 members (1 real + 19 seed)
  const memberIds = [CFG.realMemberId];
  const seededMemberIds = [];

  for (let i = 2; i <= 20; i += 1) {
    const email = `seed.member${String(i).padStart(2, "0")}@angle.demo`;
    const fullName = `Seed Member ${String(i).padStart(2, "0")}`;
    const phone = `+6591${String(100000 + i).slice(-6)}`;
    const id = await ensureUserByEmail(email, fullName, phone);
    memberIds.push(id);
    seededMemberIds.push(id);
  }

  // ensure real member profile also present
  const { data: realUser } = await admin.from("users").select("id, email").eq("id", CFG.realMemberId).maybeSingle();
  if (realUser?.email) {
    await admin.from("user_profiles").upsert(
      { id: CFG.realMemberId, email: realUser.email, full_name: "Real Member", role: "client" },
      { onConflict: "id" },
    );
  }

  // 2) seed 30 sessions
  const now = new Date();
  const sessionRows = [];
  for (let i = 1; i <= 30; i += 1) {
    const dayOffset = i - 20; // 19 past, today-ish, 10 future
    const base = new Date(now);
    base.setDate(base.getDate() + dayOffset);
    const hour = i % 3 === 0 ? 19 : i % 5 === 0 ? 7 : 18;
    const minute = i % 4 === 0 ? 30 : 0;
    const start = atTime(base, hour, minute);
    const end = new Date(start.getTime() + Number(cls.duration_min ?? 60) * 60 * 1000);
    const status = i % 15 === 0 ? "cancelled" : start < new Date(now.getTime() - 24 * 60 * 60 * 1000) ? "completed" : "scheduled";
    const guestPrice = i % 5 === 0 ? 120 : i % 3 === 0 ? 80 : 100;
    const creditsRequired = i % 6 === 0 ? 2 : 1;

    sessionRows.push({
      class_id: CFG.classId,
      start_time: iso(start),
      end_time: iso(end),
      spots_left: Number(cls.capacity ?? 10),
      location_id: CFG.locationId,
      capacity: Number(cls.capacity ?? 10),
      status,
      guest_price: guestPrice,
      credits_required: creditsRequired,
      share_slug: `${CFG.seedTag.toLowerCase()}-s${String(i).padStart(2, "0")}`,
      cancelled_reason: status === "cancelled" ? "seed_demo" : null,
    });
  }

  const { data: insertedSessions, error: insSessionErr } = await admin
    .from("class_sessions")
    .insert(sessionRows)
    .select("id, start_time, capacity, status, guest_price, credits_required");
  if (insSessionErr) throw insSessionErr;

  const sessions = [...(insertedSessions ?? [])].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );

  // 3) seed 30 booking-linked paid payments (single)
  const bookingRows = [];
  for (let i = 0; i < 30; i += 1) {
    const s = sessions[i];
    const memberId = memberIds[i % memberIds.length];
    const start = new Date(s.start_time);
    const createdAt = new Date(start.getTime() - (36 - (i % 10)) * 60 * 60 * 1000);
    const status = i % 11 === 0 ? "cancelled" : i % 7 === 0 ? "no_show" : i % 4 === 0 ? "attended" : "booked";

    bookingRows.push({
      session_id: s.id,
      client_id: memberId,
      status,
      payment_status: "paid",
      location_id: CFG.locationId,
      created_at: iso(createdAt),
      checked_in_at: status === "attended" ? iso(new Date(start.getTime() + 8 * 60 * 1000)) : null,
    });
  }

  const { data: insertedBookings, error: insBookingErr } = await admin
    .from("bookings")
    .insert(bookingRows)
    .select("id, session_id, client_id, created_at");
  if (insBookingErr) throw insBookingErr;

  const bookingPayments = (insertedBookings ?? []).map((b, idx) => {
    const amount = 70 + (idx % 6) * 10;
    const createdAt = new Date(b.created_at);
    return {
      studio_id: CFG.studioId,
      location_id: CFG.locationId,
      client_id: b.client_id,
      booking_id: b.id,
      package_id: null,
      amount,
      paid_amount: amount,
      type: "single",
      status: "paid",
      payment_method: idx % 3 === 0 ? "cash" : idx % 2 === 0 ? "paynow" : "hitpay",
      currency: "SGD",
      reference_code: `${CFG.seedTag}-B-${String(idx + 1).padStart(3, "0")}`,
      created_at: createdAt.toISOString(),
      paid_at: new Date(createdAt.getTime() + 20 * 60 * 1000).toISOString(),
      verified_at: new Date(createdAt.getTime() + 30 * 60 * 1000).toISOString(),
      verified_by: CFG.ownerId,
      recon_status: "matched",
      recon_note: "seed_demo",
      invoice_status: "issued",
      invoice_number: `INV-${CFG.seedTag.slice(-8)}-${String(idx + 1).padStart(4, "0")}`,
      gateway_status: "completed",
    };
  });

  const { data: insertedBookingPayments, error: payErr } = await admin
    .from("payments")
    .insert(bookingPayments)
    .select("id, booking_id");
  if (payErr) throw payErr;

  for (const row of insertedBookingPayments ?? []) {
    const { error: upErr } = await admin.from("bookings").update({ payment_id: row.id }).eq("id", row.booking_id);
    if (upErr) throw upErr;
  }

  // 4) seed extra 10 paid package payments (total payments = 40)
  const packagePayments = Array.from({ length: 10 }, (_, i) => {
    const memberId = memberIds[i % memberIds.length];
    const createdAt = new Date(now.getTime() - (20 - i) * 24 * 60 * 60 * 1000);
    return {
      studio_id: CFG.studioId,
      location_id: CFG.locationId,
      client_id: memberId,
      booking_id: null,
      package_id: CFG.packageId,
      amount: Number(pkg.price ?? 200),
      paid_amount: Number(pkg.price ?? 200),
      type: "package",
      status: "paid",
      payment_method: i % 2 === 0 ? "hitpay" : "paynow",
      currency: "SGD",
      reference_code: `${CFG.seedTag}-P-${String(i + 1).padStart(3, "0")}`,
      created_at: createdAt.toISOString(),
      paid_at: new Date(createdAt.getTime() + 15 * 60 * 1000).toISOString(),
      verified_at: new Date(createdAt.getTime() + 20 * 60 * 1000).toISOString(),
      verified_by: CFG.ownerId,
      recon_status: "matched",
      recon_note: "seed_demo",
      invoice_status: "issued",
      invoice_number: `INV-${CFG.seedTag.slice(-8)}-P${String(i + 1).padStart(3, "0")}`,
      gateway_status: "completed",
    };
  });

  const { error: pkgPayErr } = await admin.from("payments").insert(packagePayments);
  if (pkgPayErr) throw pkgPayErr;

  // 5) seed class-pass balances for each member
  const cpRows = memberIds.map((memberId, i) => ({
    client_id: memberId,
    package_id: CFG.packageId,
    credits_left: Math.max(1, Number(pkg.credits ?? 10) - (i % 4)),
    expiry_date: new Date(now.getTime() + (45 + (i % 50)) * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(now.getTime() - (10 - (i % 8)) * 24 * 60 * 60 * 1000).toISOString(),
  }));
  const { error: cpInsertErr } = await admin.from("client_packages").insert(cpRows);
  if (cpInsertErr) throw cpInsertErr;

  // 6) recompute spots_left for seeded sessions
  const sessionIdList = sessions.map((s) => s.id);
  const { data: bookingsAgg, error: aggErr } = await admin
    .from("bookings")
    .select("session_id,status")
    .in("session_id", sessionIdList);
  if (aggErr) throw aggErr;

  const activeStatuses = new Set(["booked", "attended", "pending"]);
  const activeCountBySession = new Map();
  for (const row of bookingsAgg ?? []) {
    if (!activeStatuses.has(row.status)) continue;
    activeCountBySession.set(row.session_id, (activeCountBySession.get(row.session_id) ?? 0) + 1);
  }

  for (const s of sessions) {
    const cap = Number(s.capacity ?? 10);
    const active = Number(activeCountBySession.get(s.id) ?? 0);
    const nextSpots = Math.max(cap - active, 0);
    const { error: upSpotsErr } = await admin.from("class_sessions").update({ spots_left: nextSpots }).eq("id", s.id);
    if (upSpotsErr) throw upSpotsErr;
  }

  const { count: memberPaidCount } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", CFG.studioId)
    .in("client_id", memberIds)
    .eq("status", "paid");

  console.log(JSON.stringify({
    ok: true,
    seeded_members_total: memberIds.length,
    seeded_members_new: seededMemberIds.length,
    seeded_sessions: sessions.length,
    seeded_bookings: insertedBookings?.length ?? 0,
    seeded_payments: (insertedBookingPayments?.length ?? 0) + packagePayments.length,
    paid_payments_for_members: memberPaidCount ?? 0,
    seed_tag: CFG.seedTag,
  }, null, 2));
}

main().catch((err) => {
  console.error("seed failed", err);
  process.exit(1);
});

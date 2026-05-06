import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  try {
    const p = path.resolve(process.cwd(), ".env.local");
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore .env.local parsing errors (env may already be set by runtime)
  }
}

loadDotEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const CFG = {
  studioSlug: "angle",
  // Optional: keep using a real member so dashboards show member-linked rows.
  // If this user doesn't exist in your Supabase auth, set to null and we'll seed guest-only bookings/payments.
  realMemberId: "f7cdadc7-2fff-4f3f-b10b-13099b2dfd77",
  seedTag: `SEEDM-ANGLE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`,
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

async function resolveAngleContext() {
  const { data: studio, error: studioErr } = await admin
    .from("studios")
    .select("id, public_slug, owner_id")
    .eq("public_slug", CFG.studioSlug)
    .maybeSingle();
  if (studioErr) throw studioErr;
  if (!studio?.id) throw new Error(`studio not found for public_slug=${CFG.studioSlug}`);

  const studioId = studio.id;
  const ownerId = studio.owner_id ?? null;

  const { data: location, error: locErr } = await admin
    .from("locations")
    .select("id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (locErr) throw locErr;
  if (!location?.id) throw new Error(`no active location for studio_id=${studioId}`);

  const { data: cls, error: classErr } = await admin
    .from("classes")
    .select("id, capacity, duration_min, title, description, image_url")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (classErr) throw classErr;
  if (!cls?.id) throw new Error(`no active class for studio_id=${studioId}`);

  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select("id, credits, price, name, expiry_days")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("price", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pkgErr) throw pkgErr;

  return {
    studioId,
    locationId: location.id,
    classRow: cls,
    packageRow: pkg ?? null,
    ownerId,
  };
}

async function cleanupSeedRows(ctx) {
  const likeTag = `${CFG.seedTag}%`;

  const { data: sessionRows, error: sErr } = await admin
    .from("class_sessions")
    .select("id")
    .eq("class_id", ctx.classRow.id)
    .like("share_slug", likeTag);
  if (sErr) throw sErr;
  const sessionIds = (sessionRows ?? []).map((r) => r.id);

  // Delete bookings first (we'll also delete payments linked to them below)
  let bookingIds = [];
  let paymentIdsFromBookings = [];
  if (sessionIds.length > 0) {
    const { data: bookingRows, error: bReadErr } = await admin
      .from("bookings")
      .select("id, payment_id")
      .in("session_id", sessionIds);
    if (bReadErr) throw bReadErr;
    bookingIds = (bookingRows ?? []).map((r) => r.id);
    paymentIdsFromBookings = (bookingRows ?? []).map((r) => r.payment_id).filter(Boolean);
  }

  const { error: pErr } = await admin
    .from("payments")
    .delete()
    .eq("studio_id", ctx.studioId)
    .or(
      [
        `reference_code.like.${likeTag}`,
        paymentIdsFromBookings.length ? `id.in.(${paymentIdsFromBookings.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(","),
    );
  if (pErr) throw pErr;

  if (bookingIds.length > 0) {
    const { error: bErr } = await admin.from("bookings").delete().in("id", bookingIds);
    if (bErr) throw bErr;
  }

  const { error: csErr } = await admin
    .from("class_sessions")
    .delete()
    .eq("class_id", ctx.classRow.id)
    .like("share_slug", likeTag);
  if (csErr) throw csErr;

  // Clean tagged client package balances (snapshots we seed include the tag prefix)
  if (CFG.realMemberId && ctx.packageRow?.id) {
    await admin
      .from("client_packages")
      .delete()
      .eq("client_id", CFG.realMemberId)
      .eq("package_id", ctx.packageRow.id)
      .like("package_name_snapshot", likeTag);
  }
}

async function main() {
  const ctx = await resolveAngleContext();

  await cleanupSeedRows(ctx);

  // 1) create/ensure 20 members (1 real + 19 seed)
  const memberIds = CFG.realMemberId ? [CFG.realMemberId] : [];
  const seededMemberIds = [];

  if (CFG.realMemberId) {
    for (let i = 2; i <= 20; i += 1) {
      const email = `seed.member${String(i).padStart(2, "0")}@angle.demo`;
      const fullName = `Seed Member ${String(i).padStart(2, "0")}`;
      const phone = `+6591${String(100000 + i).slice(-6)}`;
      const id = await ensureUserByEmail(email, fullName, phone);
      memberIds.push(id);
      seededMemberIds.push(id);
    }
  }

  // ensure real member profile also present
  if (CFG.realMemberId) {
    const { data: realUser } = await admin
      .from("users")
      .select("id, email")
      .eq("id", CFG.realMemberId)
      .maybeSingle();
    if (realUser?.email) {
      await admin.from("user_profiles").upsert(
        { id: CFG.realMemberId, email: realUser.email, full_name: "Real Member", role: "client" },
        { onConflict: "id" },
      );
    }
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
    const end = new Date(start.getTime() + Number(ctx.classRow.duration_min ?? 60) * 60 * 1000);
    const status = i % 15 === 0 ? "cancelled" : start < new Date(now.getTime() - 24 * 60 * 60 * 1000) ? "completed" : "scheduled";
    const guestPrice = i % 5 === 0 ? 120 : i % 3 === 0 ? 80 : 100;
    const creditsRequired = i % 6 === 0 ? 2 : 1;

    sessionRows.push({
      class_id: ctx.classRow.id,
      start_time: iso(start),
      end_time: iso(end),
      spots_left: Number(ctx.classRow.capacity ?? 10),
      location_id: ctx.locationId,
      capacity: Number(ctx.classRow.capacity ?? 10),
      status,
      guest_price: guestPrice,
      credits_required: creditsRequired,
      share_slug: `${CFG.seedTag.toLowerCase()}-s${String(i).padStart(2, "0")}`,
      cancelled_reason: status === "cancelled" ? "seed_demo" : null,
      class_title_snapshot: ctx.classRow.title ?? null,
      class_description_snapshot: ctx.classRow.description ?? null,
      class_image_url_snapshot: ctx.classRow.image_url ?? null,
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
    const memberId = memberIds.length ? memberIds[i % memberIds.length] : null;
    const start = new Date(s.start_time);
    const createdAt = new Date(start.getTime() - (36 - (i % 10)) * 60 * 60 * 1000);
    const status = i % 11 === 0 ? "cancelled" : i % 7 === 0 ? "no_show" : i % 4 === 0 ? "attended" : "booked";

    bookingRows.push({
      session_id: s.id,
      client_id: memberId,
      guest_name: memberId ? null : `Seed Guest ${String(i + 1).padStart(2, "0")}`,
      guest_email: memberId ? null : `seed.guest${String(i + 1).padStart(2, "0")}@angle.demo`,
      guest_phone: memberId ? null : `+6591${String(100000 + i + 1).slice(-6)}`,
      status,
      payment_status: "paid",
      location_id: ctx.locationId,
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
      studio_id: ctx.studioId,
      location_id: ctx.locationId,
      client_id: b.client_id,
      booking_id: b.id,
      package_id: null,
      amount,
      paid_amount: amount,
      type: "single",
      status: "paid",
      payment_method: idx % 3 === 0 ? "cash" : idx % 2 === 0 ? "paynow" : "hitpay",
      source: "online_booking",
      currency: "SGD",
      reference_code: `${CFG.seedTag}-B-${String(idx + 1).padStart(3, "0")}`,
      created_at: createdAt.toISOString(),
      paid_at: new Date(createdAt.getTime() + 20 * 60 * 1000).toISOString(),
      verified_at: new Date(createdAt.getTime() + 30 * 60 * 1000).toISOString(),
      verified_by: ctx.ownerId,
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
  const packagePayments = ctx.packageRow
    ? Array.from({ length: 10 }, (_, i) => {
    const memberId = memberIds[i % memberIds.length];
    const createdAt = new Date(now.getTime() - (20 - i) * 24 * 60 * 60 * 1000);
    return {
      studio_id: ctx.studioId,
      location_id: ctx.locationId,
      client_id: memberId,
      booking_id: null,
      package_id: ctx.packageRow.id,
      amount: Number(ctx.packageRow.price ?? 200),
      paid_amount: Number(ctx.packageRow.price ?? 200),
      type: "package",
      status: "paid",
      payment_method: i % 2 === 0 ? "hitpay" : "paynow",
      source: "package_buy",
      currency: "SGD",
      reference_code: `${CFG.seedTag}-P-${String(i + 1).padStart(3, "0")}`,
      created_at: createdAt.toISOString(),
      paid_at: new Date(createdAt.getTime() + 15 * 60 * 1000).toISOString(),
      verified_at: new Date(createdAt.getTime() + 20 * 60 * 1000).toISOString(),
      verified_by: ctx.ownerId,
      recon_status: "matched",
      recon_note: "seed_demo",
      invoice_status: "issued",
      invoice_number: `INV-${CFG.seedTag.slice(-8)}-P${String(i + 1).padStart(3, "0")}`,
      gateway_status: "completed",
      package_name_snapshot: `${CFG.seedTag} ${ctx.packageRow.name ?? "Package"}`,
    };
    })
    : [];

  const { error: pkgPayErr } = await admin.from("payments").insert(packagePayments);
  if (pkgPayErr) throw pkgPayErr;

  // 5) seed class-pass balances for each member
  if (ctx.packageRow && memberIds.length > 0) {
    const cpRows = memberIds.map((memberId, i) => ({
      client_id: memberId,
      package_id: ctx.packageRow.id,
      credits_left: Math.max(1, Number(ctx.packageRow.credits ?? 10) - (i % 4)),
      expiry_date: new Date(now.getTime() + (45 + (i % 50)) * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - (10 - (i % 8)) * 24 * 60 * 60 * 1000).toISOString(),
      package_name_snapshot: `${CFG.seedTag} ${ctx.packageRow.name ?? "Package"}`,
      package_credits_snapshot: Number(ctx.packageRow.credits ?? 10),
      package_expiry_days_snapshot: ctx.packageRow.expiry_days ?? null,
    }));
    const { error: cpInsertErr } = await admin.from("client_packages").insert(cpRows);
    if (cpInsertErr) throw cpInsertErr;
  }

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
    .eq("studio_id", ctx.studioId)
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

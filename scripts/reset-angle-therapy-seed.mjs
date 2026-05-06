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
    // ignore
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
  seedTag: `THERAPY-SEED-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`,
};

function randSlug(len = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function isoSGT(dateYmd, hh, mm = 0) {
  const h = String(hh).padStart(2, "0");
  const m = String(mm).padStart(2, "0");
  // Force Asia/Singapore wall-clock time (+08:00), store as ISO UTC
  return new Date(`${dateYmd}T${h}:${m}:00+08:00`).toISOString();
}

async function mustSingle(q, msg) {
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(msg);
  return data;
}

async function resolveCtx() {
  const studio = await mustSingle(
    admin.from("studios").select("id, public_slug, owner_id").eq("public_slug", CFG.studioSlug),
    `studio not found for public_slug=${CFG.studioSlug}`,
  );

  const location = await mustSingle(
    admin
      .from("locations")
      .select("id, name")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1),
    `no active location for studio_id=${studio.id}`,
  );

  return {
    studioId: studio.id,
    studioPublicSlug: studio.public_slug,
    ownerId: studio.owner_id ?? null,
    locationId: location.id,
    locationName: location.name ?? null,
  };
}

async function cleanupAllAngleData(ctx) {
  // 1) list instructors + packages + classes for the studio
  const [{ data: instructors, error: insErr }, { data: packages, error: pkgErr }, { data: classes, error: clsErr }] =
    await Promise.all([
      admin.from("instructors").select("id").eq("studio_id", ctx.studioId),
    admin.from("packages").select("id").eq("studio_id", ctx.studioId),
    admin.from("classes").select("id").eq("studio_id", ctx.studioId),
  ]);
  if (insErr) throw insErr;
  if (pkgErr) throw pkgErr;
  if (clsErr) throw clsErr;
  const instructorIds = (instructors ?? []).map((i) => i.id);
  const packageIds = (packages ?? []).map((p) => p.id);
  const classIds = (classes ?? []).map((c) => c.id);

  // 2) list sessions for those classes
  let sessionIds = [];
  if (classIds.length) {
    const { data: sessions, error: sErr } = await admin
      .from("class_sessions")
      .select("id")
      .in("class_id", classIds);
    if (sErr) throw sErr;
    sessionIds = (sessions ?? []).map((s) => s.id);
  }

  // 3) list bookings for those sessions
  let bookingIds = [];
  let paymentIdsFromBookings = [];
  if (sessionIds.length) {
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select("id, payment_id")
      .in("session_id", sessionIds);
    if (bErr) throw bErr;
    bookingIds = (bookings ?? []).map((b) => b.id);
    paymentIdsFromBookings = (bookings ?? []).map((b) => b.payment_id).filter(Boolean);
  }

  // 4) delete payments for this studio that are linked to these bookings OR linked to studio packages
  const paymentFilters = [
    paymentIdsFromBookings.length ? `id.in.(${paymentIdsFromBookings.join(",")})` : null,
    packageIds.length ? `package_id.in.(${packageIds.join(",")})` : null,
  ].filter(Boolean);

  if (paymentFilters.length) {
    const { error: pErr } = await admin
      .from("payments")
      .delete()
      .eq("studio_id", ctx.studioId)
      .or(paymentFilters.join(","));
    if (pErr) throw pErr;
  }

  // 5) delete client_packages for studio packages (class pass balances)
  if (packageIds.length) {
    const { error: cpErr } = await admin.from("client_packages").delete().in("package_id", packageIds);
    if (cpErr) throw cpErr;
  }

  // 6) delete bookings, sessions, then templates/packages
  if (bookingIds.length) {
    const { error: delB } = await admin.from("bookings").delete().in("id", bookingIds);
    if (delB) throw delB;
  }
  if (sessionIds.length) {
    const { error: delS } = await admin.from("class_sessions").delete().in("id", sessionIds);
    if (delS) throw delS;
  }
  if (classIds.length) {
    const { error: delC } = await admin.from("classes").delete().in("id", classIds);
    if (delC) throw delC;
  }
  if (packageIds.length) {
    const { error: delP } = await admin.from("packages").delete().in("id", packageIds);
    if (delP) throw delP;
  }
  if (instructorIds.length) {
    const { error: delI } = await admin.from("instructors").delete().in("id", instructorIds);
    if (delI) throw delI;
  }

  return {
    deleted: {
      instructorIds: instructorIds.length,
      packageIds: packageIds.length,
      classIds: classIds.length,
      sessionIds: sessionIds.length,
      bookingIds: bookingIds.length,
    },
  };
}

async function seedTherapyData(ctx) {
  const therapyTags = {
    anxiety: ["Therapy", "Anxiety", "CBT", "Panic"],
    stress: ["Therapy", "Stress", "Mindfulness", "Breathing"],
    burnout: ["Therapy", "Burnout", "Boundaries", "Recovery"],
    couples: ["Therapy", "Couples", "Communication", "Conflict repair"],
    sleep: ["Therapy", "Sleep", "Relaxation", "Nervous system"],
    teen: ["Therapy", "Teens", "Emotional regulation", "Self-awareness"],
    intake: ["Therapy", "Assessment", "Intake"],
  };

  // Instructors (more realistic)
  const instructorRows = [
    { name: "Mei Lin Tan, PsyD" },
    { name: "Jordan Lee, MA (Counselling)" },
    { name: "Aisha Rahman, MSW" },
    { name: "Chen Wei, MSc (Psychology)" },
  ].map((i, idx) => ({
    studio_id: ctx.studioId,
    location_id: ctx.locationId,
    name: i.name,
    email: null,
    phone: null,
    is_active: true,
  }));

  const { data: insertedInstructors, error: insInsErr } = await admin
    .from("instructors")
    .insert(instructorRows)
    .select("id, name");
  if (insInsErr) throw insInsErr;
  const instructors = insertedInstructors ?? [];
  const pickIns = (n) => instructors[n % Math.max(1, instructors.length)]?.id ?? null;

  const classTemplates = [
    {
      title: "Initial Consultation (50 min)",
      description: "A first session to clarify your goals, understand context, and agree on a simple plan for the next steps.",
      capacity: 1,
      duration_min: 50,
      tags: therapyTags.intake,
      guest_price_default: 150,
      credits_required_default: 1,
      instructor_slot: 0,
    },
    {
      title: "CBT for Anxiety (1:1 · 60 min)",
      description: "Evidence-based CBT tools for anxious thoughts, panic cycles, and avoidance. Practical exercises and take-home plan.",
      capacity: 1,
      duration_min: 60,
      tags: therapyTags.anxiety,
      guest_price_default: 190,
      credits_required_default: 1,
      instructor_slot: 1,
    },
    {
      title: "Stress & Burnout Recovery (1:1 · 60 min)",
      description: "Identify burnout patterns, rebuild boundaries, and design a sustainable weekly recovery routine.",
      capacity: 1,
      duration_min: 60,
      tags: [...therapyTags.stress, ...therapyTags.burnout],
      guest_price_default: 210,
      credits_required_default: 1,
      instructor_slot: 2,
    },
    {
      title: "Couples Communication (75 min)",
      description: "Guided communication practice for couples: conflict repair, needs language, and shared agreements.",
      capacity: 2,
      duration_min: 75,
      tags: therapyTags.couples,
      guest_price_default: 280,
      credits_required_default: 2,
      instructor_slot: 3,
    },
    {
      title: "Mindful Sleep Reset (Group · 60 min)",
      description: "A gentle group session: down-regulation, breathwork, and sleep hygiene basics.",
      capacity: 12,
      duration_min: 60,
      tags: therapyTags.sleep,
      guest_price_default: 49,
      credits_required_default: 1,
      instructor_slot: 0,
    },
    {
      title: "Teen Emotional Regulation (Group · 60 min)",
      description: "Teen-friendly coping skills: labeling emotions, grounding, safer communication, and support planning.",
      capacity: 10,
      duration_min: 60,
      tags: therapyTags.teen,
      guest_price_default: 59,
      credits_required_default: 1,
      instructor_slot: 2,
    },
  ];

  const classRows = classTemplates.map((t) => ({
    studio_id: ctx.studioId,
    title: t.title,
    description: t.description,
    tags: t.tags,
    capacity: t.capacity,
    duration_min: t.duration_min,
    instructor_id: pickIns(t.instructor_slot ?? 0),
    location_id: ctx.locationId,
    is_active: true,
    share_slug: randSlug(10),
    image_url: null,
    deleted_at: null,
  }));

  const { data: insertedClasses, error: insClsErr } = await admin
    .from("classes")
    .insert(classRows)
    .select("id, title, description, capacity, duration_min, share_slug");
  if (insClsErr) throw insClsErr;

  const classes = insertedClasses ?? [];
  const classByTitle = new Map(classes.map((c) => [c.title, c]));

  // Packages (class pass packs)
  const packageRows = [
    { name: "Starter Pack · 2 Sessions", credits: 2, price: 360, expiry_days: 45 },
    { name: "Progress Pack · 4 Sessions", credits: 4, price: 680, expiry_days: 90 },
    { name: "Couples Pack · 3 Sessions", credits: 3, price: 780, expiry_days: 120 },
    { name: "Group Wellness · 5 Passes", credits: 5, price: 240, expiry_days: 120 },
  ].map((p, idx) => ({
    studio_id: ctx.studioId,
    location_id: ctx.locationId,
    name: p.name,
    credits: p.credits,
    price: p.price,
    expiry_days: p.expiry_days,
    is_active: true,
    share_slug: randSlug(10),
    image_url: null,
    deleted_at: null,
  }));

  const { data: insertedPackages, error: insPkgErr } = await admin
    .from("packages")
    .insert(packageRows)
    .select("id, name, credits, price, share_slug");
  if (insPkgErr) throw insPkgErr;

  // Sessions: generate next 14 days, a mix of 1:1 and group.
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const baseYmd = `${y}-${m}-${d}`;

  const sessionPlan = [];
  for (let dayOffset = -2; dayOffset <= 10; dayOffset += 1) {
    const date = new Date(`${baseYmd}T00:00:00+08:00`);
    date.setDate(date.getDate() + dayOffset);
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    // Morning intake / anxiety
    sessionPlan.push({ title: "Initial Consultation (50 min)", ymd, hh: 9, mm: 30 });
    sessionPlan.push({ title: "CBT for Anxiety (1:1 · 60 min)", ymd, hh: 11, mm: 0 });
    // Afternoon stress
    sessionPlan.push({ title: "Stress & Burnout Recovery (1:1 · 60 min)", ymd, hh: 15, mm: 0 });
    // Evening couples (twice a week)
    if (date.getDay() === 2 || date.getDay() === 5) {
      sessionPlan.push({ title: "Couples Communication (75 min)", ymd, hh: 19, mm: 30 });
    }
    // Group sleep (once a week)
    if (date.getDay() === 4) {
      sessionPlan.push({ title: "Mindful Sleep Reset (Group · 60 min)", ymd, hh: 20, mm: 0 });
    }
    // Teen group (weekend)
    if (date.getDay() === 6) {
      sessionPlan.push({ title: "Teen Emotional Regulation (Group · 60 min)", ymd, hh: 17, mm: 0 });
    }
  }

  const sessionsToInsert = sessionPlan.map((p, idx) => {
    const cls = classByTitle.get(p.title);
    if (!cls?.id) throw new Error(`missing class template inserted for title=${p.title}`);

    const tmpl = classTemplates.find((t) => t.title === p.title);
    const durationMin = Number(cls.duration_min ?? tmpl?.duration_min ?? 60);
    const start = isoSGT(p.ymd, p.hh, p.mm);
    const end = new Date(new Date(start).getTime() + durationMin * 60 * 1000).toISOString();
    const capacity = Number(cls.capacity ?? tmpl?.capacity ?? 10);
    const guestPrice = Number(tmpl?.guest_price_default ?? 120);
    const creditsRequired = Number(tmpl?.credits_required_default ?? 1);

    return {
      class_id: cls.id,
      start_time: start,
      end_time: end,
      capacity,
      spots_left: capacity,
      location_id: ctx.locationId,
      status: "scheduled",
      guest_price: guestPrice,
      credits_required: creditsRequired,
      share_slug: `${CFG.seedTag.toLowerCase()}-sess-${String(idx + 1).padStart(3, "0")}`,
      cancelled_reason: null,
      class_title_snapshot: cls.title ?? null,
      class_description_snapshot: cls.description ?? null,
      class_image_url_snapshot: null,
    };
  });

  const { data: insertedSessions, error: insSessErr } = await admin
    .from("class_sessions")
    .insert(sessionsToInsert)
    .select("id, start_time, capacity, guest_price");
  if (insSessErr) throw insSessErr;

  // Seed some realistic guest bookings + linked payments for the next few sessions
  const guestNames = [
    ["Rachel", "Ng"], ["Daniel", "Tan"], ["Jia", "Hui"], ["Alicia", "Lim"], ["Kevin", "Wong"],
    ["Sarah", "Chen"], ["Michelle", "Teo"], ["Brandon", "Goh"], ["Ethan", "Lee"], ["Wei", "Jun"],
    ["Amelia", "Khoo"], ["Siti", "Nur"], ["Nur", "Aisyah"], ["Hannah", "Chong"], ["Yusuf", "Ibrahim"],
  ];
  const pickGuest = (i) => {
    const [a, b] = guestNames[i % guestNames.length];
    const full = `${a} ${b}`;
    const email = `seed.${a.toLowerCase()}.${b.toLowerCase()}${String(i + 1).padStart(2, "0")}@angle.demo`;
    const phone = `+6590${String(100000 + i).slice(-6)}`;
    return { full, email, phone };
  };

  const upcoming = (insertedSessions ?? [])
    .slice()
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, 18);

  const bookingRows = upcoming.map((s, i) => {
    const g = pickGuest(i);
    const createdAt = new Date(new Date(s.start_time).getTime() - (10 + (i % 8)) * 60 * 60 * 1000).toISOString();
    return {
      session_id: s.id,
      client_id: null,
      status: "booked",
      payment_status: "paid",
      location_id: ctx.locationId,
      created_at: createdAt,
      guest_name: g.full,
      guest_email: g.email,
      guest_phone: g.phone,
    };
  });

  const { data: insertedBookings, error: insBErr } = await admin
    .from("bookings")
    .insert(bookingRows)
    .select("id, created_at, session_id");
  if (insBErr) throw insBErr;

  const paymentRows = (insertedBookings ?? []).map((b, i) => {
    const amount = Number((upcoming[i]?.guest_price ?? 150) || 150);
    const createdAt = new Date(b.created_at).toISOString();
    return {
      studio_id: ctx.studioId,
      location_id: ctx.locationId,
      client_id: null,
      booking_id: b.id,
      package_id: null,
      amount,
      paid_amount: amount,
      type: "single",
      status: "paid",
      payment_method: i % 3 === 0 ? "paynow" : i % 2 === 0 ? "hitpay" : "cash",
      source: "online_booking",
      currency: "SGD",
      reference_code: `${CFG.seedTag}-B-${String(i + 1).padStart(3, "0")}`,
      created_at: createdAt,
      paid_at: new Date(new Date(createdAt).getTime() + 12 * 60 * 1000).toISOString(),
      verified_at: new Date(new Date(createdAt).getTime() + 18 * 60 * 1000).toISOString(),
      verified_by: ctx.ownerId,
      recon_status: "matched",
      recon_note: "seed_demo",
      invoice_status: "issued",
      invoice_number: `INV-${CFG.seedTag.slice(-8)}-${String(i + 1).padStart(4, "0")}`,
      gateway_status: "completed",
    };
  });

  const { data: insertedPayments, error: insPErr } = await admin
    .from("payments")
    .insert(paymentRows)
    .select("id, booking_id");
  if (insPErr) throw insPErr;

  for (const row of insertedPayments ?? []) {
    if (!row.booking_id) continue;
    const { error: upErr } = await admin.from("bookings").update({ payment_id: row.id }).eq("id", row.booking_id);
    if (upErr) throw upErr;
  }

  return {
    seedTag: CFG.seedTag,
    inserted: {
      instructors: instructors.length,
      classes: classes.length,
      packages: (insertedPackages ?? []).length,
      sessions: (insertedSessions ?? []).length,
      bookings: (insertedBookings ?? []).length,
      payments: (insertedPayments ?? []).length,
    },
  };
}

async function main() {
  const ctx = await resolveCtx();
  const cleanup = await cleanupAllAngleData(ctx);
  const seeded = await seedTherapyData(ctx);

  console.log(JSON.stringify({ ok: true, studio: CFG.studioSlug, cleanup, seeded }, null, 2));
}

main().catch((err) => {
  console.error("seed failed", err);
  process.exit(1);
});


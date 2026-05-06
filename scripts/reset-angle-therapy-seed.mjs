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

function uniqTags(tags) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tags) ? tags : []) {
    const v = String(t ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
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

  // 1b) list events for the studio
  const { data: events, error: evErr } = await admin.from("events").select("id").eq("studio_id", ctx.studioId);
  if (evErr && !String(evErr.message ?? "").includes("relation")) throw evErr;
  const eventIds = (events ?? []).map((e) => e.id);

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

  // 3b) list event_bookings for studio events (if events feature is present)
  let eventBookingIds = [];
  let paymentIdsFromEventBookings = [];
  if (eventIds.length) {
    const { data: ebs, error: ebErr } = await admin
      .from("event_bookings")
      .select("id, payment_id")
      .in("event_id", eventIds);
    if (ebErr && !String(ebErr.message ?? "").includes("relation")) throw ebErr;
    eventBookingIds = (ebs ?? []).map((b) => b.id);
    paymentIdsFromEventBookings = (ebs ?? []).map((b) => b.payment_id).filter(Boolean);
  }

  // 4) delete payments for this studio that are linked to these bookings OR linked to studio packages
  const paymentFilters = [
    paymentIdsFromBookings.length ? `id.in.(${paymentIdsFromBookings.join(",")})` : null,
    paymentIdsFromEventBookings.length ? `id.in.(${paymentIdsFromEventBookings.join(",")})` : null,
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
  if (eventBookingIds.length) {
    const { error: delEB } = await admin.from("event_bookings").delete().in("id", eventBookingIds);
    if (delEB && !String(delEB.message ?? "").includes("relation")) throw delEB;
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
  if (eventIds.length) {
    const { error: delE } = await admin.from("events").delete().in("id", eventIds);
    if (delE && !String(delE.message ?? "").includes("relation")) throw delE;
  }

  return {
    deleted: {
      instructorIds: instructorIds.length,
      packageIds: packageIds.length,
      classIds: classIds.length,
      eventIds: eventIds.length,
      eventBookingIds: eventBookingIds.length,
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
      tags: uniqTags([...therapyTags.stress, ...therapyTags.burnout]),
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

  // ── Events: standalone paid activities (hotel partnerships, talks, workshops) ──
  // Events feature may not exist in older databases; skip gracefully.
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const ymdPlus = (days) => {
    const d2 = new Date(`${ymd}T00:00:00+08:00`);
    d2.setDate(d2.getDate() + days);
    return `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
  };

  const eventTemplates = [
    {
      title: "Hotel Partnership · Reset & Recover Workshop (90 min)",
      description:
        "A guided nervous system reset session with breathwork, grounding, and a short CBT-based reflection. Suitable for all levels.",
      tags: ["Event", "Workshop", "Partner", "Breathwork", "Stress"],
      start: { days: 3, hh: 18, mm: 30 },
      end: { days: 3, hh: 20, mm: 0 },
      capacity: 40,
      price: 49,
      video_url: "https://www.youtube.com/watch?v=O-6f5wQXSu8",
    },
    {
      title: "Corporate Lunch Talk · Burnout Prevention (45 min + Q&A)",
      description:
        "A practical talk on early burnout signals, boundary setting, and sustainable recovery habits. Includes guided Q&A.",
      tags: ["Event", "Talk", "Corporate", "Burnout", "Boundaries"],
      start: { days: 7, hh: 12, mm: 15 },
      end: { days: 7, hh: 13, mm: 15 },
      capacity: 80,
      price: 29,
      video_url: null,
    },
    {
      title: "Couples Mini-Retreat · Repair After Conflict (2 hours)",
      description:
        "A small-group couples workshop focused on conflict repair, emotional safety, and collaborative agreements. Guided practice included.",
      tags: ["Event", "Couples", "Communication", "Workshop"],
      start: { days: 12, hh: 10, mm: 0 },
      end: { days: 12, hh: 12, mm: 0 },
      capacity: 16,
      price: 120,
      video_url: "https://vimeo.com/76979871",
    },
    {
      title: "Past Event · Mindful Sleep Reset (60 min)",
      description:
        "A gentle evening session on sleep down-regulation, routines, and practical tools to reduce nighttime anxiety.",
      tags: ["Event", "Sleep", "Mindfulness"],
      start: { days: -6, hh: 19, mm: 30 },
      end: { days: -6, hh: 20, mm: 30 },
      capacity: 25,
      price: 39,
      video_url: null,
    },
  ];

  let insertedEvents = [];
  try {
    const eventRows = eventTemplates.map((e, idx) => {
      const startYmd = ymdPlus(e.start.days);
      const endYmd = ymdPlus(e.end.days);
      const start_time = isoSGT(startYmd, e.start.hh, e.start.mm);
      const end_time = isoSGT(endYmd, e.end.hh, e.end.mm);
      return {
        studio_id: ctx.studioId,
        location_id: ctx.locationId,
        title: e.title,
        description: e.description,
        tags: uniqTags(e.tags),
        start_time,
        end_time,
        capacity: e.capacity,
        spots_left: e.capacity,
        price: e.price,
        currency: "SGD",
        is_active: true,
        share_slug: `${CFG.seedTag.toLowerCase()}-evt-${String(idx + 1).padStart(3, "0")}`,
        image_url: null,
        video_url: e.video_url,
      };
    });

    const { data: evInserted, error: evInsErr } = await admin
      .from("events")
      .insert(eventRows)
      .select("id, title, start_time, end_time, capacity, spots_left, price, share_slug");
    if (evInsErr) throw evInsErr;
    insertedEvents = evInserted ?? [];

    // Create some realistic paid event bookings + payments (for upcoming events only)
    const paidEventTargets = insertedEvents
      .filter((e) => new Date(e.end_time).getTime() >= Date.now())
      .slice(0, 3);

    const evBookingRows = [];
    for (let i = 0; i < paidEventTargets.length; i += 1) {
      const ev = paidEventTargets[i];
      const bookingCount = Math.min(5 + i * 2, 12);
      for (let j = 0; j < bookingCount; j += 1) {
        const g = pickGuest(i * 25 + j);
        const createdAt = new Date(new Date(ev.start_time).getTime() - (24 + (j % 10)) * 60 * 60 * 1000).toISOString();
        evBookingRows.push({
          event_id: ev.id,
          location_id: ctx.locationId,
          client_id: null,
          status: "booked",
          payment_status: "paid",
          created_at: createdAt,
          guest_name: g.full,
          guest_email: g.email,
          guest_phone: g.phone,
        });
      }
      // update spots_left for the event
      const remaining = Math.max(0, Number(ev.capacity ?? 0) - bookingCount);
      await admin.from("events").update({ spots_left: remaining }).eq("id", ev.id);
    }

    const { data: evBookingsInserted, error: evBInsErr } = await admin
      .from("event_bookings")
      .insert(evBookingRows)
      .select("id, created_at, event_id");
    if (evBInsErr) throw evBInsErr;

    const evById = new Map(insertedEvents.map((e) => [e.id, e]));
    const evPaymentRows = (evBookingsInserted ?? []).map((b, i) => {
      const ev = evById.get(b.event_id);
      const amount = Number(ev?.price ?? 49);
      const createdAt = new Date(b.created_at).toISOString();
      return {
        studio_id: ctx.studioId,
        location_id: ctx.locationId,
        client_id: null,
        booking_id: null,
        package_id: null,
        event_booking_id: b.id,
        amount,
        paid_amount: amount,
        type: "single",
        status: "paid",
        payment_method: i % 3 === 0 ? "paynow" : i % 2 === 0 ? "hitpay" : "cash",
        source: "event_booking",
        currency: "SGD",
        reference_code: `${CFG.seedTag}-E-${String(i + 1).padStart(4, "0")}`,
        created_at: createdAt,
        paid_at: new Date(new Date(createdAt).getTime() + 7 * 60 * 1000).toISOString(),
        verified_at: new Date(new Date(createdAt).getTime() + 11 * 60 * 1000).toISOString(),
        verified_by: ctx.ownerId,
        recon_status: "matched",
        recon_note: "seed_demo",
        invoice_status: "issued",
        invoice_number: `INV-${CFG.seedTag.slice(-8)}-EVT-${String(i + 1).padStart(4, "0")}`,
        gateway_status: "completed",
      };
    });

    const { data: evPaymentsInserted, error: evPErr } = await admin
      .from("payments")
      .insert(evPaymentRows)
      .select("id, event_booking_id");
    if (evPErr) throw evPErr;

    for (const row of evPaymentsInserted ?? []) {
      if (!row.event_booking_id) continue;
      const { error: upErr } = await admin.from("event_bookings").update({ payment_id: row.id }).eq("id", row.event_booking_id);
      if (upErr) throw upErr;
    }
  } catch (e) {
    // If events tables/migrations aren't applied yet, just skip seeding events.
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.toLowerCase().includes("relation") && !msg.toLowerCase().includes("does not exist")) throw e;
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
      events: insertedEvents.length,
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


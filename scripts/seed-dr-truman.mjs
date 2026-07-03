/**
 * Seed Dr. Truman plastic surgery merchant public-page content.
 *
 * Usage:
 *   node scripts/seed-dr-truman.mjs
 *
 * Optional env (.env.local):
 *   SEED_OWNER_EMAIL          — required if studio dr-truman does not exist yet
 *   SEED_WHATSAPP_E164        — e.g. +6591234567 (enables WhatsApp FAB when set)
 *   SEED_CALCOM_EMBED_URL     — Cal.com embed URL (enables booking section when set)
 *   SEED_CONTACT_EMAIL        — public contact email
 */
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

const STUDIO_SLUG = "dr-truman";
const SEED_PREFIX = "dr-truman";

const PUBLIC_INTRO = `Dr. Truman specializes in refined facial and body contouring—with a focus on natural results, meticulous technique, and clear guidance from consultation through recovery.

• Transconjunctival lower blepharoplasty (no external scar)
• Hair restoration
• Advanced body contouring & liposuction
• Breast augmentation revision & capsular contracture care

Every plan starts with a private consultation. Message us on WhatsApp or book online to discuss your goals, candidacy, and recovery timeline.`;

const WHATSAPP_PREFILL =
  "Hi Dr. Truman team — I'd like to enquire about [procedure name]. My preferred contact time is: ";

const MEMBER_ZONE_SERIES = {
  title: "Expert Course: Choosing Surgery & Recovery",
  summary: "Free education on natural-looking results, consultation prep, and what recovery really looks like.",
  description: `These guides are for general education only—not medical advice. Every patient receives personalized instructions after consultation and booking.

Ready to discuss your goals? Browse our procedures or message us on WhatsApp.`,
  access_type: "free",
  sort_order: 10,
  share_slug: "patient-guides",
  promo_video_url: null,
};

// Placeholder embeds for demo; lesson copy is in description.
const DEMO_LESSON_VIDEO = "https://vimeo.com/76979871";

const MEMBER_ZONE_LESSONS = [
  {
    title: "What “good” plastic surgery actually looks like",
    summary: "Natural proportion, symmetry, and results that still look like you.",
    duration_min: 8,
    sort_order: 10,
    media_url: DEMO_LESSON_VIDEO,
    description: `Good aesthetic surgery is usually noticed for how natural you look—not for obvious “work done.”

What to look for in outcomes (and in a surgeon’s portfolio):
• Facial harmony: changes support your bone structure and age; lower lids look smoother, not hollow or over-pulled.
• Body contouring: smoother silhouettes and defined transitions—not uneven dips, ripples, or an unnatural “sculpted” look.
• Hair restoration: hairline shape suits your face; grafts follow natural growth direction; density goals are realistic for donor supply.
• Breast revision: improved symmetry, softer contour, and implants that sit in a stable position—not high, hard, or visibly distorted.

Red flags in marketing (not in good practice):
• One-size “ideal” photos that ignore your anatomy
• Promises with no discussion of limits, scars, or recovery time
• No clear plan for follow-up and complications

A quality consultation should explain trade-offs, show healed results (not just immediate post-op), and give you a timeline you can plan life around.`,
  },
  {
    title: "How to prepare for your consultation",
    summary: "Bring clear goals, honest history, and the right questions.",
    duration_min: 10,
    sort_order: 20,
    media_url: DEMO_LESSON_VIDEO,
    description: `Your consultation is where suitability, safety, and expectations are set. Preparation helps you get a useful answer—not a sales pitch.

Before you arrive:
• Clarify your top 1–2 concerns (photos of yourself in neutral light can help).
• List medications, supplements, allergies, and past surgeries.
• Note smoking, alcohol, and any plans for pregnancy or major weight change.
• Bring prior imaging or operative reports if you had breast implants or revision surgery elsewhere.

Questions worth asking:
• Am I a good candidate for this procedure—or is a different approach better?
• What technique do you recommend for me, and why?
• Where will scars be, and what is the typical recovery before social events or work?
• What follow-up schedule do you use, and who do I contact after hours?
• What are the main risks for my case, and how are complications handled?

What happens next:
If you proceed, detailed pre-op instructions are issued after scheduling—not at the first enquiry. That is when fasting rules, medication changes, and arrival logistics are confirmed for your specific plan.`,
  },
  {
    title: "Recovery timelines: what to expect by procedure",
    summary: "High-level guides for eyes, hair, body contouring, and breast revision.",
    duration_min: 12,
    sort_order: 30,
    media_url: DEMO_LESSON_VIDEO,
    description: `Recovery is procedure-specific. Below are typical patterns—your surgeon will personalize timing.

Transconjunctival lower blepharoplasty
• Days 1–3: swelling, bruising, mild dryness or foreign-body sensation are common.
• Week 1–2: most people feel comfortable in public with makeup or sunglasses.
• Months 1–3: subtle contour refinement continues; avoid rubbing the eyes throughout.

Hair restoration (FUE / FUT)
• Days 1–7: graft protection is critical—gentle washing only as instructed, no scratching the recipient area.
• Weeks 2–4: transplanted hairs may shed (shock loss); this is often normal.
• Months 3–12: gradual regrowth; density builds slowly; sun protection matters for scalp comfort.

Body contouring & liposuction
• Week 1: compression garments and limited activity are central to comfort and shape.
• Weeks 2–4: gradual return to desk work; strenuous exercise waits until cleared.
• Months 1–3: swelling resolves unevenly; final contour can take several months.

Breast augmentation revision
• Weeks 1–2: support garments, limited arm movement, and incision care as directed.
• Months 1–3: tissues soften; implants settle; stiffness can be normal after revision.
• Months 3–6+: scar maturation and long-term imaging follow-up may be recommended.

This overview does not replace your written aftercare guide or emergency instructions.`,
  },
  {
    title: "When to call the clinic—and what is usually normal",
    summary: "Know urgent warning signs vs. expected healing discomfort.",
    duration_min: 6,
    sort_order: 40,
    media_url: DEMO_LESSON_VIDEO,
    description: `Healing includes uncomfortable but expected symptoms. Urgent problems need fast contact.

Contact the clinic urgently if you have:
• Sudden severe pain not relieved by prescribed medication
• Heavy or rapidly increasing bleeding
• Fever, spreading redness, or pus-like drainage
• One side swelling much faster than the other after body or breast surgery
• Sudden vision changes or severe eye pain after eyelid surgery
• Shortness of breath or chest pain after general anesthesia (call emergency services first)

Often normal in early recovery (still ask if unsure):
• Mild oozing, bruising, tightness, or numbness near incisions
• Itching, dryness, or mild asymmetry while swelling is uneven
• Fatigue and interrupted sleep the first week
• Temporary hair shedding after transplant

For non-urgent questions during office hours, use WhatsApp or your coordinator line. After booking, you will receive direct contact pathways and follow-up appointment dates.

This guide is educational only. If you are a current patient with new symptoms, follow the instructions given to you at discharge.`,
  },
];

const SERVICES = [
  {
    title: "Transconjunctival Lower Blepharoplasty",
    summary: "Refresh tired under-eyes with an internal (no external scar) approach.",
    description: `Reduce under-eye bags and puffiness through a transconjunctival technique—incisions hidden inside the lower eyelid, so there is no visible external scar.

Ideal for patients bothered by lower-lid fullness who want a cleaner, more rested appearance. Dr. Truman will assess eyelid anatomy, fat distribution, and skin quality during your consultation.

Recovery highlights: most swelling improves in the first 1–2 weeks; final contour refines over 1–3 months. Full personalized aftercare instructions are provided after your procedure.

Enquire to schedule a consultation.`,
    tags: ["blepharoplasty", "lower eyelid", "eye bag removal", "facial"],
    sort_order: 10,
    share_slug: "transconjunctival-lower-blepharoplasty",
  },
  {
    title: "Hair Restoration (FUE / FUT)",
    summary: "Restore hairline density with follicle-level precision and structured aftercare.",
    description: `Address thinning hairlines, temples, and crown loss with a tailored transplant plan. Grafts are placed to match your natural growth direction and long-term aesthetic goals.

Your consultation covers donor capacity, recipient design, and realistic density expectations. Structured post-op care protects graft survival during the critical first week.

Book a consultation to review candidacy, timeline, and pricing.`,
    tags: ["hair transplant", "FUE", "hair restoration", "scalp"],
    sort_order: 20,
    share_slug: "hair-restoration-fue-fut",
  },
  {
    title: "Body Contouring & Liposuction",
    summary: "Sculpt waist, arms, thighs, and neck with precision contouring and compression-guided recovery.",
    description: `Target stubborn fat and improve silhouette definition in areas such as abdomen, flanks, upper arms, thighs, and posterior neck. Techniques are selected based on your anatomy and goals—not a one-size plan.

Compression and activity guidance are central to smooth results and comfort. Dr. Truman's team will outline preparation, garment wear, and follow-up before your procedure date.

WhatsApp us to discuss areas of concern and whether contouring is right for you.`,
    tags: ["liposuction", "body contouring", "waist", "arms", "thighs"],
    sort_order: 30,
    share_slug: "body-contouring-liposuction",
  },
  {
    title: "Breast Augmentation Revision",
    summary: "Address capsular contracture, asymmetry, or implant concerns with a revision-focused plan.",
    description: `Revision surgery requires a different roadmap than first-time augmentation. Common goals include improving symmetry, softening capsular contracture, correcting implant position, and updating size or profile.

Consultation includes assessment of existing implants, capsule tissue, scar quality, and chest wall anatomy. Long-term follow-up and imaging guidance are part of responsible revision care.

Enquire now for a confidential revision assessment.`,
    tags: ["breast revision", "capsular contracture", "implant revision"],
    sort_order: 40,
    share_slug: "breast-augmentation-revision",
  },
];

const FAQS = [
  {
    sort_order: 10,
    question: "How do I start?",
    answer:
      "Book online (Book section) or WhatsApp us with the procedure you're interested in and your preferred call-back time. We'll arrange a private consultation to review goals, medical history, and candidacy.",
  },
  {
    sort_order: 20,
    question: "What should I do before surgery?",
    answer:
      "Preparation varies by procedure. Generally: stop smoking and alcohol as advised, disclose medications and supplements, arrange reliable transport home, and follow fasting instructions if general anesthesia applies. Full pre-op instructions are provided after you are scheduled—not at first enquiry.",
  },
  {
    sort_order: 30,
    question: "What is recovery like?",
    answer:
      "Timelines differ: eyelid procedures often show social downtime in ~1–2 weeks; body contouring emphasizes compression and gradual return to activity; hair transplants focus on graft protection in week one; revision breast surgery includes a longer softening phase (months). Your surgeon will give a personalized plan.",
  },
  {
    sort_order: 40,
    question: "When should I contact the clinic urgently?",
    answer:
      "Seek immediate advice for sudden severe pain, heavy bleeding, fever, spreading redness, or rapid swelling asymmetry. For non-urgent questions during office hours, use WhatsApp or your coordinator line.",
  },
  {
    sort_order: 50,
    question: "Do you provide aftercare instructions?",
    answer:
      "Yes. Detailed perioperative guides (wound care, compression, diet, follow-up schedule) are issued after booking, tailored to your procedure. The website summarizes services only.",
  },
  {
    sort_order: 60,
    question: "What follow-up visits are typical?",
    answer:
      "Most procedures include checks at day 1, day 3, day 7, then 1 / 3 / 6 months (exact schedule depends on surgery type). Revision breast cases may include longer imaging follow-up.",
  },
  {
    sort_order: 70,
    question: "Are procedures scarless?",
    answer:
      "Transconjunctival lower blepharoplasty avoids an external eyelid scar. Other procedures use discreet incisions; scar care is discussed at consultation.",
  },
  {
    sort_order: 80,
    question: "Is everything on this page medical advice?",
    answer:
      "No. This site is for general information and enquiries only. Diagnosis, suitability, and treatment plans require an in-person or tele-consult with Dr. Truman.",
  },
];

async function resolveOwnerId() {
  const email = String(process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!email) return null;
  const { data, error } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function ensureStudio() {
  const { data: existing, error } = await admin
    .from("studios")
    .select("id, public_slug, owner_id")
    .eq("public_slug", STUDIO_SLUG)
    .maybeSingle();
  if (error) throw error;
  if (existing?.id) return existing;

  const ownerId = await resolveOwnerId();
  if (!ownerId) {
    throw new Error(
      `Studio /${STUDIO_SLUG} not found. Set SEED_OWNER_EMAIL in .env.local to create it, or create the studio in the dashboard first.`,
    );
  }

  const { data: created, error: insErr } = await admin
    .from("studios")
    .insert({
      name: "Dr. Truman Plastic Surgery",
      owner_id: ownerId,
      public_slug: STUDIO_SLUG,
    })
    .select("id, public_slug, owner_id")
    .single();
  if (insErr) throw insErr;

  const { error: locErr } = await admin.from("locations").insert({
    studio_id: created.id,
    name: "Main Clinic",
    address: "Address to be confirmed — update in Dashboard → Settings → Locations",
    is_active: true,
  });
  if (locErr) console.warn("location insert:", locErr.message);

  return created;
}

async function upsertStudioProfile(studioId) {
  const whatsappE164 = String(process.env.SEED_WHATSAPP_E164 ?? "").trim() || null;
  const contactEmail = String(process.env.SEED_CONTACT_EMAIL ?? "").trim() || null;
  const calcomUrl = String(process.env.SEED_CALCOM_EMBED_URL ?? "").trim() || null;

  const patch = {
    name: "Dr. Truman Plastic Surgery",
    public_slug: STUDIO_SLUG,
    public_brand_name: "Dr. Truman",
    public_intro: PUBLIC_INTRO,
    public_services_title: "Treatments",
    public_member_zone_title: "Expert courses",
    whatsapp_enabled: Boolean(whatsappE164),
    whatsapp_number_e164: whatsappE164,
    whatsapp_prefill_text: WHATSAPP_PREFILL,
    public_contact_email: contactEmail,
    calcom_booking_enabled: Boolean(calcomUrl),
    calcom_embed_url: calcomUrl,
  };

  const { error } = await admin.from("studios").update(patch).eq("id", studioId);
  if (error) throw error;
}

async function ensureLocation(studioId) {
  const { data: rows, error: listErr } = await admin
    .from("locations")
    .select("id, name, address")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (listErr) throw listErr;

  if (rows?.[0]?.id) {
    const needsAddress = !String(rows[0].address ?? "").trim();
    if (needsAddress) {
      await admin
        .from("locations")
        .update({
          name: rows[0].name || "Main Clinic",
          address: "Singapore — update full address in Dashboard → Settings → Locations",
        })
        .eq("id", rows[0].id);
    }
    return rows[0].id;
  }

  const { data: created, error: insErr } = await admin
    .from("locations")
    .insert({
      studio_id: studioId,
      name: "Main Clinic",
      address: "Singapore — update full address in Dashboard → Settings → Locations",
      is_active: true,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return created.id;
}

async function replaceServices(studioId) {
  const { error: delErr } = await admin.from("studio_services").delete().eq("studio_id", studioId);
  if (delErr) throw delErr;

  const rows = SERVICES.map((s) => ({
    studio_id: studioId,
    title: s.title,
    summary: s.summary,
    description: s.description,
    price: null,
    currency: "SGD",
    cover_image_url: null,
    video_url: null,
    tags: s.tags,
    is_active: true,
    sort_order: s.sort_order,
    share_slug: `${SEED_PREFIX}-${s.share_slug}`,
  }));

  const { data, error } = await admin.from("studio_services").insert(rows).select("id, title, share_slug");
  if (error) throw error;
  return data ?? [];
}

async function replaceMemberZone(studioId) {
  const { data: existingSeries, error: listErr } = await admin
    .from("member_zone_series")
    .select("id")
    .eq("studio_id", studioId);
  if (listErr) throw listErr;

  const seriesIds = (existingSeries ?? []).map((r) => r.id);
  if (seriesIds.length > 0) {
    const { error: delLessonsErr } = await admin.from("member_zone_lessons").delete().in("series_id", seriesIds);
    if (delLessonsErr) throw delLessonsErr;
    const { error: delSeriesErr } = await admin.from("member_zone_series").delete().eq("studio_id", studioId);
    if (delSeriesErr) throw delSeriesErr;
  }

  const { data: series, error: seriesErr } = await admin
    .from("member_zone_series")
    .insert({
      studio_id: studioId,
      title: MEMBER_ZONE_SERIES.title,
      summary: MEMBER_ZONE_SERIES.summary,
      description: MEMBER_ZONE_SERIES.description,
      cover_image_url: null,
      promo_video_url: MEMBER_ZONE_SERIES.promo_video_url,
      access_type: MEMBER_ZONE_SERIES.access_type,
      price: 0,
      currency: "SGD",
      is_active: true,
      sort_order: MEMBER_ZONE_SERIES.sort_order,
      share_slug: `${SEED_PREFIX}-${MEMBER_ZONE_SERIES.share_slug}`,
    })
    .select("id, title, share_slug")
    .single();
  if (seriesErr) throw seriesErr;

  const lessonRows = MEMBER_ZONE_LESSONS.map((lesson) => ({
    series_id: series.id,
    title: lesson.title,
    summary: lesson.summary,
    description: lesson.description,
    media_url: lesson.media_url,
    media_type: "video",
    duration_min: lesson.duration_min,
    access_override: "inherit",
    override_price: 0,
    currency: "SGD",
    is_active: true,
    sort_order: lesson.sort_order,
  }));

  const { data: lessons, error: lessonErr } = await admin
    .from("member_zone_lessons")
    .insert(lessonRows)
    .select("id, title");
  if (lessonErr) throw lessonErr;

  return { series, lessons: lessons ?? [] };
}

async function replaceFaqs(studioId) {
  const { error: delErr } = await admin.from("studio_faqs").delete().eq("studio_id", studioId);
  if (delErr) throw delErr;

  const rows = FAQS.map((f) => ({
    studio_id: studioId,
    question: f.question,
    answer: f.answer,
    sort_order: f.sort_order,
  }));

  const { data, error } = await admin.from("studio_faqs").insert(rows).select("id, question");
  if (error) throw error;
  return data ?? [];
}

async function verifyPublicPayload(studioId) {
  const [{ data: studio }, { data: services }, { data: faqs }, { data: locations }, { data: mzSeries }] =
    await Promise.all([
    admin
      .from("studios")
      .select(
        "public_slug, public_brand_name, public_intro, public_services_title, public_member_zone_title, whatsapp_enabled, calcom_booking_enabled, calcom_embed_url",
      )
      .eq("id", studioId)
      .single(),
    admin.from("studio_services").select("id").eq("studio_id", studioId).eq("is_active", true),
    admin.from("studio_faqs").select("id").eq("studio_id", studioId),
    admin.from("locations").select("id").eq("studio_id", studioId).eq("is_active", true),
    admin.from("member_zone_series").select("id").eq("studio_id", studioId).eq("is_active", true),
  ]);

  return {
    slug: studio?.public_slug,
    brand: studio?.public_brand_name,
    servicesTitle: studio?.public_services_title,
    memberZoneTitle: studio?.public_member_zone_title,
    introLength: (studio?.public_intro ?? "").length,
    whatsappEnabled: studio?.whatsapp_enabled,
    calcomEnabled: studio?.calcom_booking_enabled,
    calcomUrlSet: Boolean(studio?.calcom_embed_url),
    activeServices: services?.length ?? 0,
    faqs: faqs?.length ?? 0,
    locations: locations?.length ?? 0,
    memberZoneSeries: mzSeries?.length ?? 0,
  };
}

async function main() {
  const studio = await ensureStudio();
  await upsertStudioProfile(studio.id);
  const locationId = await ensureLocation(studio.id);
  const services = await replaceServices(studio.id);
  const faqs = await replaceFaqs(studio.id);
  const memberZone = await replaceMemberZone(studio.id);
  const verify = await verifyPublicPayload(studio.id);

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicUrl: `/${STUDIO_SLUG}`,
        memberZoneUrl: `/${STUDIO_SLUG}/member-zone/${memberZone.series.share_slug}`,
        studioId: studio.id,
        locationId,
        servicesSeeded: services.length,
        faqsSeeded: faqs.length,
        memberZoneLessonsSeeded: memberZone.lessons.length,
        verify,
        notes: [
          verify.whatsappEnabled
            ? null
            : "Set SEED_WHATSAPP_E164 in .env.local and re-run to enable WhatsApp FAB.",
          verify.calcomUrlSet
            ? null
            : "Set SEED_CALCOM_EMBED_URL in .env.local and re-run to enable Cal.com booking.",
          "Upload procedure cover images in Dashboard → Services.",
          "Update clinic address in Dashboard → Settings → Locations.",
        ].filter(Boolean),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("seed-dr-truman failed:", err);
  process.exit(1);
});

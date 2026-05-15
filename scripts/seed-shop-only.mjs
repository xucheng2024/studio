/**
 * Insert demo shop products for a studio without wiping other data.
 * Usage: node scripts/seed-shop-only.mjs [studioSlug]
 * Default studio: breathify
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const force = args.includes("--force");
const studioSlug = (args.find((a) => !a.startsWith("--")) ?? "breathify").trim().toLowerCase();

function randSlug(len = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[buf[i] % alphabet.length];
  return out;
}

async function main() {
  const { data: studio, error: studioErr } = await admin
    .from("studios")
    .select("id, public_slug, public_shop_title")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (studioErr) throw studioErr;
  if (!studio?.id) throw new Error(`studio not found: ${studioSlug}`);

  const { count, error: countErr } = await admin
    .from("shop_products")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studio.id)
    .eq("is_active", true);
  if (countErr) throw countErr;
  const prefix = `shop-seed-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  const defs = [
    { title: "Breathwork Journal", summary: "Daily regulation prompts.", price: 28, stock_qty: 40, sort_order: 10 },
    { title: "Weighted Eye Pillow", summary: "Lavender eye pillow.", price: 45, stock_qty: 18, sort_order: 20 },
    { title: "Studio Tote Bag", summary: "Reusable canvas tote.", price: 35, stock_qty: null, sort_order: 30 },
    { title: "Foam Roller (45 cm)", summary: "Recovery support.", price: 58, stock_qty: 12, sort_order: 40 },
    { title: "Aromatherapy Roller", summary: "Calming pulse-point blend.", price: 22, stock_qty: 0, sort_order: 50 },
    { title: "Gift Card · SGD 100", summary: "Redeemable toward sessions or shop.", price: 100, stock_qty: null, sort_order: 60 },
  ];

  if ((count ?? 0) > 0 && !force) {
    const { data: existing } = await admin.from("shop_products").select("title").eq("studio_id", studio.id).eq("is_active", true);
    const titles = new Set((existing ?? []).map((r) => r.title));
    const missing = defs.filter((d) => !titles.has(d.title));
    if (missing.length === 0) {
      console.log(
        JSON.stringify(
          { ok: true, skipped: true, studio: studioSlug, active_products: count, message: "All seed products already exist" },
          null,
          2,
        ),
      );
      return;
    }
    const rows = missing.map((p, idx) => ({
      studio_id: studio.id,
      title: p.title,
      summary: p.summary,
      description: p.summary,
      image_url: null,
      price: p.price,
      currency: "SGD",
      stock_qty: p.stock_qty,
      is_active: true,
      sort_order: p.sort_order,
      share_slug: `${prefix}-add-${String(idx + 1).padStart(2, "0")}-${randSlug(6)}`,
    }));
    await admin.from("studios").update({ public_shop_title: studio.public_shop_title?.trim() || "Wellness Shop" }).eq("id", studio.id);
    const { data: added, error: addErr } = await admin.from("shop_products").insert(rows).select("id, title");
    if (addErr) throw addErr;
    console.log(JSON.stringify({ ok: true, studio: studioSlug, mode: "append", inserted: added }, null, 2));
    return;
  }

  if ((count ?? 0) > 0 && force) {
    const { data: old } = await admin.from("shop_products").select("id").eq("studio_id", studio.id).like("share_slug", "shop-seed%");
    const ids = (old ?? []).map((r) => r.id);
    if (ids.length) {
      await admin.from("shop_orders").delete().in("product_id", ids);
      await admin.from("payments").delete().eq("studio_id", studio.id).in("shop_product_id", ids);
      await admin.from("shop_products").delete().in("id", ids);
    }
  } else if ((count ?? 0) > 0) {
    // handled above via append
  }

  const rows = defs.map((p, idx) => ({
    studio_id: studio.id,
    title: p.title,
    summary: p.summary,
    description: p.summary,
    image_url: null,
    price: p.price,
    currency: "SGD",
    stock_qty: p.stock_qty,
    is_active: true,
    sort_order: p.sort_order,
    share_slug: `${prefix}-${String(idx + 1).padStart(2, "0")}-${randSlug(6)}`,
  }));

  await admin.from("studios").update({ public_shop_title: studio.public_shop_title?.trim() || "Wellness Shop" }).eq("id", studio.id);

  const { data: inserted, error: insErr } = await admin.from("shop_products").insert(rows).select("id, title, share_slug");
  if (insErr) throw insErr;

  console.log(
    JSON.stringify(
      { ok: true, studio: studioSlug, inserted: inserted?.length ?? 0, products: inserted },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("seed-shop-only failed", err);
  process.exit(1);
});

/**
 * Runs the deployed PKG-01 opening-balance RPC.
 * Defaults to dry-run. Pass --apply to write append-only ledger entries.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const studioId = process.env.POS_PKG_TARGET_STUDIO_ID?.trim() || null;
const apply = process.argv.includes("--apply");

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.rpc("backfill_pkg01_opening_balance", {
  p_studio_id: studioId,
  p_actor_id: null,
  p_actor_role: "system",
  p_limit: 5000,
  p_dry_run: !apply,
});

if (error) {
  const detail = [error.message, error.code, error.details, error.hint].filter(Boolean).join(" | ");
  throw new Error(`PKG-01 opening-balance ${apply ? "apply" : "dry-run"} failed: ${detail || "unknown Supabase error"}`);
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  scope: studioId ? "single_studio" : "all_studios",
  result: data,
}, null, 2));

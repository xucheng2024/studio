import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StudioContractStatus = "active" | "suspended";

export function isStudioContractSuspended(studio: { contract_status?: string | null } | null | undefined) {
  return studio != null && studio.contract_status === "suspended";
}

/** Returns a 403/404 JSON response when the studio cannot accept operational traffic. */
export async function respondIfStudioContractSuspended(
  admin: SupabaseClient,
  studioId: string,
): Promise<NextResponse | null> {
  const { data: row } = await admin.from("studios").select("contract_status").eq("id", studioId).maybeSingle();
  if (!row) return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  if (row.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
  }
  return null;
}

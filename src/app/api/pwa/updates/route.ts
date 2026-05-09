import { NextResponse } from "next/server";
import { getStudioSectionUpdates } from "@/lib/pwaUpdates";
import { normalizeStudioSlug } from "@/lib/slug";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const studioSlug = normalizeStudioSlug(searchParams.get("studioSlug") ?? "");
  if (!studioSlug) {
    return NextResponse.json({ error: "invalid_studio_slug" }, { status: 400 });
  }

  const data = await getStudioSectionUpdates(studioSlug);
  if (!data) return NextResponse.json({ updates: {} });
  return NextResponse.json({ updates: data.updates });
}

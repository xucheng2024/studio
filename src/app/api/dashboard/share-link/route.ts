import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { generateShareSlugSegment, isValidShareSlug, normalizeShareSlugInput } from "@/lib/shareSlug";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  entity_type: z.enum(["class", "package", "session"]),
  entity_id: z.string().uuid(),
  slug: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const base = getAppBaseUrlFromRequest(req);

  if (parsed.data.entity_type === "package") {
    const { data: row, error } = await admin
      .from("packages")
      .select("id, studio_id, location_id, share_slug")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const scope = await requireStaffScope({
      userId: user.id,
      studioId: row.studio_id,
      locationId: row.location_id,
      roles: ["owner", "manager", "frontdesk"],
    });
    if (!scope.ok) return staffScopeFailureResponse(scope);

    const { data: studio } = await admin
      .from("studios")
      .select("public_slug, contract_status")
      .eq("id", row.studio_id)
      .maybeSingle();
    if (!studio?.public_slug || studio.contract_status === "suspended") {
      return NextResponse.json({ error: "studio_unavailable" }, { status: 409 });
    }

    const slugResult = await resolveShareSlug(admin, "packages", row.id, row.share_slug, parsed.data.slug);
    if (!slugResult.ok) {
      return NextResponse.json(
        { error: slugResult.error },
        { status: slugResult.status },
      );
    }

    const url = `${base}/buy/${studio.public_slug}/${slugResult.slug}`;
    revalidatePath("/checkout");
    revalidatePath(`/buy/${studio.public_slug}/${slugResult.slug}`);
    return NextResponse.json({ url, share_slug: slugResult.slug });
  }

  if (parsed.data.entity_type === "session") {
    const { data: session, error: sErr } = await admin
      .from("class_sessions")
      .select("id, class_id, location_id, classes!inner(id, studio_id, location_id, share_slug)")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (sErr || !session) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const sessionClass = Array.isArray(session.classes) ? session.classes[0] : session.classes;
    if (!sessionClass) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

    const scope = await requireStaffScope({
      userId: user.id,
      studioId: sessionClass.studio_id,
      locationId: session.location_id ?? sessionClass.location_id,
      roles: ["owner", "manager", "frontdesk"],
    });
    if (!scope.ok) return staffScopeFailureResponse(scope);

    const { data: studio } = await admin
      .from("studios")
      .select("public_slug, contract_status")
      .eq("id", sessionClass.studio_id)
      .maybeSingle();
    if (!studio?.public_slug || studio.contract_status === "suspended") {
      return NextResponse.json({ error: "studio_unavailable" }, { status: 409 });
    }

    const slugResult = await resolveShareSlug(
      admin,
      "classes",
      sessionClass.id,
      sessionClass.share_slug,
      parsed.data.slug,
    );
    if (!slugResult.ok) {
      return NextResponse.json({ error: slugResult.error }, { status: slugResult.status });
    }

    const url = `${base}/class/${studio.public_slug}/${slugResult.slug}?session_id=${session.id}`;
    revalidatePath("/booking");
    revalidatePath(`/class/${studio.public_slug}/${slugResult.slug}`);
    return NextResponse.json({ url, share_slug: slugResult.slug, session_id: session.id });
  }

  const { data: cls, error: cErr } = await admin
    .from("classes")
    .select("id, studio_id, location_id, share_slug")
    .eq("id", parsed.data.entity_id)
    .maybeSingle();
  if (cErr || !cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: cls.studio_id,
    locationId: cls.location_id,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const { data: studio } = await admin
    .from("studios")
    .select("public_slug, contract_status")
    .eq("id", cls.studio_id)
    .maybeSingle();
  if (!studio?.public_slug || studio.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_unavailable" }, { status: 409 });
  }

  const slugResult = await resolveShareSlug(admin, "classes", cls.id, cls.share_slug, parsed.data.slug);
  if (!slugResult.ok) {
    return NextResponse.json({ error: slugResult.error }, { status: slugResult.status });
  }

  const url = `${base}/class/${studio.public_slug}/${slugResult.slug}`;
  revalidatePath("/booking");
  revalidatePath(`/class/${studio.public_slug}/${slugResult.slug}`);
  return NextResponse.json({ url, share_slug: slugResult.slug });
}

async function resolveShareSlug(
  admin: ReturnType<typeof createAdminClient>,
  table: "packages" | "classes",
  id: string,
  existing: string | null,
  customRaw: string | undefined,
): Promise<{ ok: true; slug: string } | { ok: false; error: string; status: number }> {
  const doUpdate = async (slug: string) => {
    if (table === "packages") {
      return admin.from("packages").update({ share_slug: slug }).eq("id", id);
    }
    return admin.from("classes").update({ share_slug: slug }).eq("id", id);
  };

  if (customRaw !== undefined) {
    const n = normalizeShareSlugInput(customRaw);
    if (!n) return { ok: false, error: "invalid_slug", status: 400 };
    const { error } = await doUpdate(n);
    if (error) return { ok: false, error: "slug_taken_or_invalid", status: 409 };
    return { ok: true, slug: n };
  }
  if (existing && isValidShareSlug(existing)) {
    return { ok: true, slug: existing };
  }
  for (let i = 0; i < 15; i++) {
    const candidate = generateShareSlugSegment(10);
    const { error } = await doUpdate(candidate);
    if (!error) return { ok: true, slug: candidate };
  }
  return { ok: false, error: "slug_generation_failed", status: 500 };
}

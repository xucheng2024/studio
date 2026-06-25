import { revalidatePublicSectionPaths } from "@/lib/revalidatePublic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioUrlFromRequest } from "@/lib/app-url";
import { generateShareSlugSegment, isValidShareSlug, normalizeShareSlugInput } from "@/lib/shareSlug";
import { requireGlobalStaffScope, requireStaffMutationScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  entity_type: z.enum(["class", "package", "service", "session", "membership"]),
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

  if (parsed.data.entity_type === "package") {
    const { data: row, error } = await admin
      .from("packages")
      .select("id, studio_id, location_id, share_slug, deleted_at")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if ((row as { deleted_at?: string | null }).deleted_at) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const scope = await requireStaffMutationScope({
      userId: user.id,
      studioId: row.studio_id,
      currentLocationId: row.location_id,
      targetLocationId: row.location_id,
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

    const url = getStudioUrlFromRequest(req, studio.public_slug, `packages/${slugResult.slug}`);
    revalidatePublicSectionPaths(studio.public_slug, "packages", slugResult.slug);
    return NextResponse.json({ url, share_slug: slugResult.slug });
  }

  if (parsed.data.entity_type === "membership") {
    const { data: row, error } = await admin
      .from("membership_products")
      .select("id, studio_id, location_id, share_slug, deleted_at")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if ((row as { deleted_at?: string | null }).deleted_at) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const scope = await requireStaffMutationScope({
      userId: user.id,
      studioId: row.studio_id,
      currentLocationId: row.location_id,
      targetLocationId: row.location_id,
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

    const slugResult = await resolveShareSlug(admin, "membership_products", row.id, row.share_slug, parsed.data.slug);
    if (!slugResult.ok) {
      return NextResponse.json({ error: slugResult.error }, { status: slugResult.status });
    }

    const url = getStudioUrlFromRequest(req, studio.public_slug, `memberships/${slugResult.slug}`);
    revalidatePublicSectionPaths(studio.public_slug, "memberships", slugResult.slug);
    return NextResponse.json({ url, share_slug: slugResult.slug });
  }

  if (parsed.data.entity_type === "service") {
    const { data: row, error } = await admin
      .from("studio_services")
      .select("id, studio_id, share_slug")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const scope = await requireGlobalStaffScope({
      userId: user.id,
      studioId: row.studio_id,
      roles: ["owner", "manager"],
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

    const slugResult = await resolveShareSlug(admin, "studio_services", row.id, row.share_slug, parsed.data.slug);
    if (!slugResult.ok) {
      return NextResponse.json({ error: slugResult.error }, { status: slugResult.status });
    }

    const url = getStudioUrlFromRequest(req, studio.public_slug, `services/${slugResult.slug}`);
    revalidatePublicSectionPaths(studio.public_slug, "services", slugResult.slug);
    return NextResponse.json({ url, share_slug: slugResult.slug });
  }

  if (parsed.data.entity_type === "session") {
    const { data: session, error: sErr } = await admin
      .from("class_sessions")
      .select("id, class_id, location_id, share_slug, classes!inner(id, studio_id, location_id, share_slug)")
      .eq("id", parsed.data.entity_id)
      .maybeSingle();
    if (sErr || !session) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const sessionClass = Array.isArray(session.classes) ? session.classes[0] : session.classes;
    if (!sessionClass) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

    const scope = await requireStaffMutationScope({
      userId: user.id,
      studioId: sessionClass.studio_id,
      currentLocationId: session.location_id ?? sessionClass.location_id,
      targetLocationId: session.location_id ?? sessionClass.location_id,
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

    // Ensure the parent class has a stable slug (auto-generate only; custom slug from the
    // request applies to the SESSION, not the class, so we pass undefined here).
    const classSlugResult = await resolveShareSlug(
      admin,
      "classes",
      sessionClass.id,
      sessionClass.share_slug,
      undefined,
    );
    if (!classSlugResult.ok) {
      return NextResponse.json({ error: classSlugResult.error }, { status: classSlugResult.status });
    }

    // Resolve the session's own share_slug (custom slug from request applies here).
    const sessionSlugResult = await resolveShareSlug(
      admin,
      "class_sessions",
      session.id,
      (session as { share_slug?: string | null }).share_slug ?? null,
      parsed.data.slug,
    );
    if (!sessionSlugResult.ok) {
      return NextResponse.json({ error: sessionSlugResult.error }, { status: sessionSlugResult.status });
    }

    // Use the human-readable session slug in the shared URL.
    // The class page accepts both ?session=<slug> and ?session_id=<uuid> so
    // direct links with UUIDs (e.g. from ops tools) keep working.
    const url = getStudioUrlFromRequest(
      req,
      studio.public_slug,
      `classes/${classSlugResult.slug}?session=${sessionSlugResult.slug}`,
    );
    revalidatePublicSectionPaths(studio.public_slug, "classes", classSlugResult.slug);
    return NextResponse.json({
      url,
      share_slug: classSlugResult.slug,
      session_share_slug: sessionSlugResult.slug,
      session_id: session.id,
    });
  }

  const { data: cls, error: cErr } = await admin
    .from("classes")
    .select("id, studio_id, location_id, share_slug")
    .eq("id", parsed.data.entity_id)
    .maybeSingle();
  if (cErr || !cls) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffMutationScope({
    userId: user.id,
    studioId: cls.studio_id,
    currentLocationId: cls.location_id,
    targetLocationId: cls.location_id,
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

  const url = getStudioUrlFromRequest(req, studio.public_slug, `classes/${slugResult.slug}`);
  revalidatePublicSectionPaths(studio.public_slug, "classes", slugResult.slug);
  return NextResponse.json({ url, share_slug: slugResult.slug });
}

async function resolveShareSlug(
  admin: ReturnType<typeof createAdminClient>,
  table: "packages" | "classes" | "class_sessions" | "studio_services" | "membership_products",
  id: string,
  existing: string | null | undefined,
  customRaw: string | undefined,
): Promise<{ ok: true; slug: string } | { ok: false; error: string; status: number }> {
  const doUpdate = async (slug: string) => {
    if (table === "packages") {
      return admin.from("packages").update({ share_slug: slug }).eq("id", id);
    }
    if (table === "membership_products") {
      return admin.from("membership_products").update({ share_slug: slug }).eq("id", id);
    }
    if (table === "class_sessions") {
      return admin.from("class_sessions").update({ share_slug: slug }).eq("id", id);
    }
    if (table === "studio_services") {
      return admin.from("studio_services").update({ share_slug: slug }).eq("id", id);
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

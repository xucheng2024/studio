import { revalidatePath } from "next/cache";
import { revalidatePublicStudioPath } from "@/lib/revalidatePublic";
import { NextResponse } from "next/server";
import {
  COVER_ALLOWED_MIME,
  COVER_MAX_BYTES,
  COVER_MEDIA_BUCKET,
  extensionForMime,
  isTrustedCoverImageUrl,
  storagePathFromCoverUrl,
} from "@/lib/coverMedia";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCoverImage } from "@/lib/imageTransform";
import { createClient } from "@/lib/supabase/server";

function safeSegment(raw: string, fallback: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
  return cleaned || fallback;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!studioId) return NextResponse.json({ error: "studio_id_required" }, { status: 400 });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > COVER_MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", max_mb: 5 }, { status: 400 });
  }
  if (!COVER_ALLOWED_MIME.has(file.type || "")) {
    return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });
  }
  if (!extensionForMime(file.type)) return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const folder = safeSegment(String(formData.get("folder") ?? "studio"), "studio");
  const entityId = safeSegment(String(formData.get("entity_id") ?? "common"), "common");
  const isStudioPublicLogoUpload = folder === "studios" && entityId === "public-logo";
  const admin = createAdminClient();

  let previousLogoPath: string | null = null;
  let studioPublicSlug: string | null = null;
  if (isStudioPublicLogoUpload) {
    const { data: studioRow, error: studioErr } = await admin
      .from("studios")
      .select("id, public_logo_url, public_slug")
      .eq("id", studioId)
      .maybeSingle();
    if (studioErr || !studioRow) {
      return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
    }
    previousLogoPath = storagePathFromCoverUrl((studioRow as { public_logo_url?: string | null }).public_logo_url ?? null);
    studioPublicSlug = (studioRow as { public_slug?: string | null }).public_slug ?? null;
  }

  const source = Buffer.from(await file.arrayBuffer());
  const variant = entityId.includes("logo")
    ? "logo"
    : folder === "shop"
      ? "square"
      : "cover";
  const normalized = await normalizeCoverImage(source, file.type, variant);
  const objectPath = `${folder}/${studioId}/${entityId}-${Date.now()}.${normalized.ext}`;

  const { error: upErr } = await admin.storage.from(COVER_MEDIA_BUCKET).upload(objectPath, normalized.buffer, {
    contentType: normalized.mime,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: upErr.message ?? "upload_failed" }, { status: 500 });
  }

  const { data } = admin.storage.from(COVER_MEDIA_BUCKET).getPublicUrl(objectPath);
  if (!isTrustedCoverImageUrl(data.publicUrl)) {
    await admin.storage.from(COVER_MEDIA_BUCKET).remove([objectPath]);
    return NextResponse.json({ error: "upload_integrity" }, { status: 500 });
  }

  if (isStudioPublicLogoUpload) {
    const { error: dbErr } = await admin
      .from("studios")
      .update({ public_logo_url: data.publicUrl })
      .eq("id", studioId);
    if (dbErr) {
      await admin.storage.from(COVER_MEDIA_BUCKET).remove([objectPath]);
      return NextResponse.json({ error: dbErr.message ?? "save_failed" }, { status: 500 });
    }
    if (previousLogoPath && previousLogoPath !== objectPath) {
      await admin.storage.from(COVER_MEDIA_BUCKET).remove([previousLogoPath]);
    }
    revalidatePath("/dashboard/settings/public-profile");
    if (studioPublicSlug) revalidatePublicStudioPath(studioPublicSlug);
  }

  return NextResponse.json({ ok: true, url: data.publicUrl });
}

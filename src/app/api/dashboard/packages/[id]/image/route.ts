import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  COVER_ALLOWED_MIME,
  COVER_MAX_BYTES,
  COVER_MEDIA_BUCKET,
  extensionForMime,
  isTrustedCoverImageUrl,
  storagePathFromCoverUrl,
} from "@/lib/coverMedia";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("packages")
    .select("id, studio_id, location_id, image_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > COVER_MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", max_mb: 5 }, { status: 400 });
  }
  const mime = file.type || "";
  if (!COVER_ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });
  }
  const ext = extensionForMime(mime);
  if (!ext) return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });

  // 1. Upload new file first — if this fails, the old image is untouched.
  const objectPath = `packages/${id}/cover-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(COVER_MEDIA_BUCKET).upload(objectPath, buf, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: upErr.message ?? "upload_failed" }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(COVER_MEDIA_BUCKET).getPublicUrl(objectPath);
  const publicUrl = pub.publicUrl;
  if (!isTrustedCoverImageUrl(publicUrl)) {
    await admin.storage.from(COVER_MEDIA_BUCKET).remove([objectPath]);
    return NextResponse.json({ error: "upload_integrity" }, { status: 500 });
  }

  // 2. Update DB — if this fails, remove the newly uploaded file to avoid orphans.
  const now = new Date().toISOString();
  const { error: dbErr } = await admin
    .from("packages")
    .update({ image_url: publicUrl, image_updated_at: now })
    .eq("id", id);
  if (dbErr) {
    await admin.storage.from(COVER_MEDIA_BUCKET).remove([objectPath]);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  // 3. Best-effort cleanup of old file now that DB points to the new one.
  const oldPath = storagePathFromCoverUrl(row.image_url as string | null);
  if (oldPath) {
    await admin.storage.from(COVER_MEDIA_BUCKET).remove([oldPath]);
  }

  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
  return NextResponse.json({ ok: true, image_url: publicUrl, image_updated_at: now });
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("packages")
    .select("id, studio_id, location_id, image_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: row.studio_id,
    locationId: row.location_id,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const oldPath = storagePathFromCoverUrl(row.image_url as string | null);
  if (oldPath) {
    await admin.storage.from(COVER_MEDIA_BUCKET).remove([oldPath]);
  }

  const now = new Date().toISOString();
  const { error: dbErr } = await admin
    .from("packages")
    .update({ image_url: null, image_updated_at: now })
    .eq("id", id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  revalidatePath("/dashboard/packages");
  revalidatePath("/checkout");
  return NextResponse.json({ ok: true, image_url: null });
}

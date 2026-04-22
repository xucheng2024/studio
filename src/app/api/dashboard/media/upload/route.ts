import { NextResponse } from "next/server";
import {
  COVER_ALLOWED_MIME,
  COVER_MAX_BYTES,
  COVER_MEDIA_BUCKET,
  extensionForMime,
  isTrustedCoverImageUrl,
} from "@/lib/coverMedia";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const ext = extensionForMime(file.type);
  if (!ext) return NextResponse.json({ error: "invalid_file_type" }, { status: 400 });

  const scope = await requireStaffScope({
    userId: user.id,
    studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const folder = safeSegment(String(formData.get("folder") ?? "studio"), "studio");
  const entityId = safeSegment(String(formData.get("entity_id") ?? "common"), "common");
  const objectPath = `${folder}/${studioId}/${entityId}-${Date.now()}.${ext}`;

  const admin = createAdminClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(COVER_MEDIA_BUCKET).upload(objectPath, buf, {
    contentType: file.type,
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
  return NextResponse.json({ ok: true, url: data.publicUrl });
}

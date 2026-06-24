import { NextResponse } from "next/server";
import { z } from "zod";
import { isReservedCustomDomain, normalizeCustomDomainInput, toCustomDomainUiStatus } from "@/lib/customDomain";
import { persistCustomDomainSnapshot, verifyCustomDomain } from "@/lib/customDomain.server";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  studio_id: z.string().uuid(),
  domain: z.string().trim().min(1).max(253),
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

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: parsed.data.studio_id,
    roles: ["owner", "manager"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const domain = normalizeCustomDomainInput(parsed.data.domain);
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("custom_domain, custom_domain_vercel_status")
    .eq("id", parsed.data.studio_id)
    .maybeSingle();
  const savedDomain = normalizeCustomDomainInput((studio as { custom_domain?: string | null } | null)?.custom_domain ?? "");
  if (!savedDomain) {
    return NextResponse.json({ error: "domain_not_saved" }, { status: 409 });
  }
  if (isReservedCustomDomain(savedDomain)) {
    return NextResponse.json({ error: "reserved_domain" }, { status: 409 });
  }
  if (savedDomain !== domain) {
    return NextResponse.json({ error: "save_before_verify" }, { status: 409 });
  }
  const snapshot = await verifyCustomDomain({
    domain: savedDomain,
    vercelStatus: (studio as { custom_domain_vercel_status?: "not_configured" | "registered" | "failed" | "unknown" | null } | null)?.custom_domain_vercel_status ?? "unknown",
  });
  await persistCustomDomainSnapshot(parsed.data.studio_id, snapshot);
  return NextResponse.json({ ok: true, status: toCustomDomainUiStatus(snapshot) });
}

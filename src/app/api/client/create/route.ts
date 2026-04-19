import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional().nullable(),
});

/**
 * Creates an auth user + public.users row (client) for email OTP / password flows.
 * Password is random; user should sign in via Supabase email OTP from the client.
 * Caller must be authenticated staff (owner / manager / frontdesk).
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Require authenticated staff – this route uses the service role and must not
  // be callable anonymously (anyone with the URL could otherwise create users).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const email = parsed.data.email.trim().toLowerCase();

  const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing?.id) {
    return NextResponse.json({ ok: true, existed: true, user_id: existing.id });
  }

  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "client",
      full_name: parsed.data.name.trim(),
      phone: parsed.data.phone?.trim() ?? undefined,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      return NextResponse.json({ ok: true, existed: true, message: error.message });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    existed: false,
    user_id: data.user?.id,
  });
}

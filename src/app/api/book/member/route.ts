import { NextResponse } from "next/server";
import { z } from "zod";
import { createAutoMemberClassBooking, loadClassSessionBookingStudio } from "@/lib/bookingTransitions";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
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
  await sweepExpiredPendingPayments(admin);
  const sessionContext = await loadClassSessionBookingStudio(admin, parsed.data.session_id);
  if (!sessionContext.ok) {
    return NextResponse.json({ error: sessionContext.error }, { status: sessionContext.status });
  }

  const { studioId } = sessionContext;
  if (studioId) {
    const { data: st } = await admin.from("studios").select("contract_status").eq("id", studioId).maybeSingle();
    if (st?.contract_status === "suspended") {
      return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
    }
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId,
      bootstrapIfMissing: true,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }

  const result = await createAutoMemberClassBooking(admin, {
    sessionId: parsed.data.session_id,
    clientId: user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    booking_id: result.bookingId,
    selected_package_id: result.selectedPackageId,
    credits_required: result.creditsRequired,
  });
}

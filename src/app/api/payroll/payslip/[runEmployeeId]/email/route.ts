import { NextResponse } from "next/server";
import { sendPublishedPayslipEmail } from "@/lib/payroll-payslips";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ runEmployeeId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { runEmployeeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await sendPublishedPayslipEmail({
    runEmployeeId,
    userId: user.id,
    email: user.email,
  });
  if (!result.ok) {
    console.error("[PAY-03] payslip email rejected", { runEmployeeId, reason: result.reason });
    if (result.reason === "forbidden") return NextResponse.json({ error: result.reason }, { status: 403 });
    if (result.reason === "not_found") return NextResponse.json({ error: result.reason }, { status: 404 });
    if (result.reason === "recipient_not_found") return NextResponse.json({ error: result.reason }, { status: 422 });
    if (result.reason === "email_not_configured") {
      return NextResponse.json(
        { error: result.reason, error_detail: "This studio has not enabled its own Resend account." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }
  return NextResponse.json({ ok: true, payslip_number: result.payslipNumber, recipient: result.toEmail });
}

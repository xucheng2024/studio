import { NextResponse } from "next/server";
import { resolvePayslipForUser } from "@/lib/payroll-payslips";
import { renderPayslipPdf } from "@/lib/payslip-pdf";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ runEmployeeId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { runEmployeeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await resolvePayslipForUser({ runEmployeeId, userId: user.id, email: user.email });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "forbidden" ? 403 : 404 });
  const pdfBuffer = await renderPayslipPdf(result.model);
  return new Response(Buffer.from(pdfBuffer) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Payslip_${result.model.payslipNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

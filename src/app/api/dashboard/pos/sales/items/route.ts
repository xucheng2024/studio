import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertPosSaleItem } from "@/lib/pos-sales";
import { createClient } from "@/lib/supabase/server";
import { posErrorResponse } from "../../_shared";

const bodySchema = z.object({
  studio_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  item_id: z.string().uuid().nullable().optional(),
  line_number: z.number().int().nullable().optional(),
  item_type: z.enum(["service", "product", "package"]).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  package_id: z.string().uuid().nullable().optional(),
  salon_appointment_id: z.string().uuid().nullable().optional(),
  employee_id: z.string().uuid().nullable().optional(),
  item_name_snapshot: z.string().nullable().optional(),
  item_currency_snapshot: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unit_price_amount: z.number().nullable().optional(),
  discount_amount: z.number().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await upsertPosSaleItem({
    userId: user.id,
    studioId: parsed.data.studio_id,
    saleId: parsed.data.sale_id,
    itemId: parsed.data.item_id ?? null,
    lineNumber: parsed.data.line_number ?? null,
    itemType: parsed.data.item_type ?? null,
    serviceId: parsed.data.service_id ?? null,
    productId: parsed.data.product_id ?? null,
    packageId: parsed.data.package_id ?? null,
    salonAppointmentId: parsed.data.salon_appointment_id ?? null,
    employeeId: parsed.data.employee_id ?? null,
    itemNameSnapshot: parsed.data.item_name_snapshot ?? null,
    itemCurrencySnapshot: parsed.data.item_currency_snapshot ?? null,
    quantity: parsed.data.quantity ?? null,
    unitPriceAmount: parsed.data.unit_price_amount ?? null,
    discountAmount: parsed.data.discount_amount ?? null,
    taxAmount: parsed.data.tax_amount ?? null,
    idempotencyKey: parsed.data.idempotency_key ?? null,
  });

  if (!result.ok) {
    return posErrorResponse(result);
  }

  return NextResponse.json({ ok: true, ...result.payload });
}


import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: "deprecated",
      message: "Email existence checks are no longer exposed by this endpoint.",
    },
    { status: 410 },
  );
}

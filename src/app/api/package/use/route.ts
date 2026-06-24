import { NextResponse } from "next/server";

/** Manual deduction (e.g. owner adjustment). Booking flow uses DB RPC instead. */
export async function POST(req: Request) {
  void req;
  return NextResponse.json(
    {
      error: "deprecated",
      message: "Manual package deduction is no longer available through this endpoint.",
    },
    { status: 410 },
  );
}

import { NextResponse } from "next/server";
import { mapPosMutationMessage } from "@/lib/pos-error-message";
import { type PosMutationErrorCode } from "@/lib/pos-sales";

export function mapPosApiErrorCodeToStatus(code: PosMutationErrorCode) {
  switch (code) {
    case "studio_not_found":
    case "not_found":
      return 404;
    case "forbidden":
    case "studio_suspended":
      return 403;
    case "invalid_request":
      return 400;
    case "idempotency_conflict":
      return 409;
    case "idempotency_in_progress":
      return 409;
    case "idempotency_permanently_failed":
      return 422;
    default:
      return 500;
  }
}

export function posErrorResponse(params: {
  code: PosMutationErrorCode;
  message: string;
}) {
  const friendlyMessage = mapPosMutationMessage(params.code, params.message);
  return NextResponse.json(
    {
      ok: false,
      error: params.code,
      message: friendlyMessage,
      raw_message: params.message,
    },
    { status: mapPosApiErrorCodeToStatus(params.code) },
  );
}

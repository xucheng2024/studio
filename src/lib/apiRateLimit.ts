import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type ApiRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function normalizeIpAddress(value: string | null | undefined) {
  const first = (value ?? "")
    .split(",")[0]
    ?.trim()
    .replace(/^::ffff:/, "");
  return first || "unknown";
}

export function getRequestIpAddress(req: Request) {
  return normalizeIpAddress(
    req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")
    ?? req.headers.get("x-real-ip"),
  );
}

export function hashRateLimitPart(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export async function consumeApiRateLimit(params: {
  action: string;
  scope: string;
  limit: number;
  windowSeconds: number;
}) {
  const admin = createAdminClient();
  const key = hashRateLimitPart(`${params.action}|${params.scope}`);
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_key: key,
    p_limit: params.limit,
    p_window_seconds: params.windowSeconds,
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    remaining: Number(row?.remaining ?? 0),
    retryAfterSeconds: Math.max(1, Number(row?.retry_after_seconds ?? params.windowSeconds)),
  } satisfies ApiRateLimitResult;
}

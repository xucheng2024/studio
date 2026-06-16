import { headers } from "next/headers";
import { getAppOriginForOg } from "@/lib/coverMedia";

export async function getRequestOriginForOg(): Promise<string> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").trim();
    if (host) {
      const proto = (h.get("x-forwarded-proto") ?? "https").trim();
      return `${proto}://${host.replace(/\/$/, "")}`;
    }
  } catch {
    // Fall through to env-based origin.
  }
  return getAppOriginForOg();
}

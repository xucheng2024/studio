import "server-only";

import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCnameTargetFromEnv,
  getCustomDomainKind,
  type CustomDomainDnsStatus,
  type CustomDomainKind,
  type CustomDomainOverallStatus,
  type CustomDomainSslStatus,
  type CustomDomainStatusSnapshot,
  type CustomDomainVercelStatus,
} from "@/lib/customDomain";

function truncateError(message: string | null | undefined): string | null {
  const value = String(message ?? "").trim();
  return value ? value.slice(0, 400) : null;
}

async function probeUrl(url: string) {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok || [301, 302, 307, 308].includes(res.status)) return true;
      if (res.status === 405) continue;
    } catch {
      // Ignore probe errors and fall through.
    }
  }
  return false;
}

async function inspectDns(domain: string, kind: CustomDomainKind, expectedTarget: string | null, httpsReady: boolean) {
  let hasAnyRecord = false;
  let hasMismatchedCname = false;

  try {
    const cnames = (await resolveCname(domain)).map((value) => value.replace(/\.$/, "").toLowerCase());
    if (cnames.length > 0) hasAnyRecord = true;
    if (expectedTarget && cnames.includes(expectedTarget.toLowerCase())) {
      return { dnsStatus: "verified" as CustomDomainDnsStatus, lastError: null };
    }
    if (cnames.length > 0 && kind === "subdomain") {
      hasMismatchedCname = true;
    }
  } catch {
    // CNAME may not exist or the provider may flatten/proxy it.
  }

  try {
    const ipv4 = await resolve4(domain);
    if (ipv4.length > 0) hasAnyRecord = true;
  } catch {
    // ignore
  }

  try {
    const ipv6 = await resolve6(domain);
    if (ipv6.length > 0) hasAnyRecord = true;
  } catch {
    // ignore
  }

  if (httpsReady) return { dnsStatus: "verified" as CustomDomainDnsStatus, lastError: null };
  if (hasMismatchedCname) {
    return {
      dnsStatus: "misconfigured" as CustomDomainDnsStatus,
      lastError: `DNS record for ${domain} does not point to the required target.`,
    };
  }
  if (hasAnyRecord) {
    return { dnsStatus: "pending" as CustomDomainDnsStatus, lastError: null };
  }
  return { dnsStatus: "pending" as CustomDomainDnsStatus, lastError: null };
}

function computeOverallStatus(params: {
  domain: string | null;
  vercelStatus: CustomDomainVercelStatus;
  dnsStatus: CustomDomainDnsStatus;
  sslStatus: CustomDomainSslStatus;
}): CustomDomainOverallStatus {
  if (!params.domain) return "not_configured";
  if (params.vercelStatus === "failed" || params.dnsStatus === "misconfigured") return "misconfigured";
  if (params.dnsStatus === "verified" && params.sslStatus === "ready") return "active";
  return "pending";
}

export async function registerDomainWithVercel(domain: string): Promise<{
  vercelStatus: CustomDomainVercelStatus;
  lastError: string | null;
}> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return {
      vercelStatus: "unknown",
      lastError: "Platform Vercel env is missing, so registration could not be confirmed from this server.",
    };
  }

  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: domain }),
      cache: "no-store",
    });
    if (res.ok) {
      return { vercelStatus: "registered", lastError: null };
    }
    const body = truncateError(await res.text().catch(() => "")) ?? `Vercel returned ${res.status}.`;
    console.error(`[registerDomainWithVercel] ${domain} → ${res.status}`, body);
    return { vercelStatus: "failed", lastError: body };
  } catch (error) {
    console.error("[registerDomainWithVercel]", error);
    return {
      vercelStatus: "failed",
      lastError: truncateError(error instanceof Error ? error.message : "Domain registration failed."),
    };
  }
}

export async function removeDomainFromVercel(domain: string): Promise<void> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return;

  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok && res.status !== 404) {
      const body = truncateError(await res.text().catch(() => ""));
      console.error(`[removeDomainFromVercel] ${domain} → ${res.status}`, body);
    }
  } catch (error) {
    console.error("[removeDomainFromVercel]", error);
  }
}

export function getNotConfiguredSnapshot(): CustomDomainStatusSnapshot {
  return {
    domain: null,
    kind: null,
    overallStatus: "not_configured",
    vercelStatus: "not_configured",
    dnsStatus: "not_configured",
    sslStatus: "not_configured",
    lastVerifiedAt: null,
    lastError: null,
  };
}

export async function verifyCustomDomain(params: {
  domain: string | null;
  vercelStatus?: CustomDomainVercelStatus;
  lastError?: string | null;
}): Promise<CustomDomainStatusSnapshot> {
  if (!params.domain) return getNotConfiguredSnapshot();

  const domain = params.domain.toLowerCase();
  const kind = getCustomDomainKind(domain);
  if (!kind) {
    return {
      domain,
      kind: null,
      overallStatus: "misconfigured",
      vercelStatus: params.vercelStatus ?? "unknown",
      dnsStatus: "unknown",
      sslStatus: "unknown",
      lastVerifiedAt: new Date().toISOString(),
      lastError: "The domain format is invalid.",
    };
  }

  const httpsReady = await probeUrl(`https://${domain}`);
  if (!httpsReady) {
    await probeUrl(`http://${domain}`);
  }
  const dnsCheck = await inspectDns(domain, kind, getCnameTargetFromEnv(), httpsReady);
  const sslStatus: CustomDomainSslStatus = httpsReady ? "ready" : "pending";
  const vercelStatus = params.vercelStatus ?? "unknown";
  const lastError =
    truncateError(params.lastError)
    ?? (dnsCheck.dnsStatus === "misconfigured" ? dnsCheck.lastError : null);

  return {
    domain,
    kind,
    overallStatus: computeOverallStatus({
      domain,
      vercelStatus,
      dnsStatus: dnsCheck.dnsStatus,
      sslStatus,
    }),
    vercelStatus,
    dnsStatus: dnsCheck.dnsStatus,
    sslStatus,
    lastVerifiedAt: new Date().toISOString(),
    lastError,
  };
}

export async function persistCustomDomainSnapshot(studioId: string, snapshot: CustomDomainStatusSnapshot) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("studios")
    .update({
      custom_domain: snapshot.domain,
      custom_domain_kind: snapshot.kind,
      custom_domain_status: snapshot.overallStatus,
      custom_domain_vercel_status: snapshot.vercelStatus,
      custom_domain_dns_status: snapshot.dnsStatus,
      custom_domain_ssl_status: snapshot.sslStatus,
      custom_domain_last_verified_at: snapshot.lastVerifiedAt,
      custom_domain_last_error: snapshot.lastError,
    })
    .eq("id", studioId);
  if (error) throw error;
}

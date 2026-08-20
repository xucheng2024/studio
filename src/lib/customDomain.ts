export type CustomDomainKind = "subdomain" | "apex";
export type CustomDomainOverallStatus = "not_configured" | "pending" | "misconfigured" | "active";
export type CustomDomainVercelStatus = "not_configured" | "registered" | "failed" | "unknown";
export type CustomDomainDnsStatus = "not_configured" | "verified" | "pending" | "misconfigured" | "unknown";
export type CustomDomainSslStatus = "not_configured" | "ready" | "pending" | "unknown";

export type CustomDomainStatusSnapshot = {
  domain: string | null;
  kind: CustomDomainKind | null;
  overallStatus: CustomDomainOverallStatus;
  vercelStatus: CustomDomainVercelStatus;
  dnsStatus: CustomDomainDnsStatus;
  sslStatus: CustomDomainSslStatus;
  lastVerifiedAt: string | null;
  lastError: string | null;
};

export type CustomDomainUiStatus = CustomDomainStatusSnapshot & {
  label: string;
  detail: string;
  tone: "neutral" | "amber" | "red" | "teal";
  checks: Array<{
    key: "vercel" | "dns" | "ssl";
    label: string;
    tone: "neutral" | "amber" | "red" | "teal";
  }>;
};

export function normalizeCustomDomainInput(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/\.$/, "").toLowerCase();
}

export function isReservedCustomDomain(domain: string | null | undefined): boolean {
  const normalized = normalizeCustomDomainInput(domain ?? "");
  if (!normalized) return false;

  const appHost = normalizeCustomDomainInput(process.env.NEXT_PUBLIC_APP_URL ?? "");
  const vercelHost = normalizeCustomDomainInput(process.env.VERCEL_URL ?? "");
  return normalized === appHost || normalized === vercelHost || normalized === "localhost";
}

export function getCustomDomainKind(domain: string | null): CustomDomainKind | null {
  if (!domain) return null;
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.length === 2 ? "apex" : "subdomain";
}

/** Apex `example.com` <-> `www.example.com`. Subdomains like `book.example.com` have no pair. */
export function getCustomDomainHostAlias(host: string | null | undefined): string | null {
  const normalized = normalizeCustomDomainInput(host ?? "");
  if (!normalized) return null;
  if (normalized.startsWith("www.")) {
    const rest = normalized.slice(4);
    return getCustomDomainKind(rest) === "apex" ? rest : null;
  }
  return getCustomDomainKind(normalized) === "apex" ? `www.${normalized}` : null;
}

export function customDomainHostCandidates(host: string | null | undefined): string[] {
  const normalized = normalizeCustomDomainInput(host ?? "");
  if (!normalized) return [];
  const alias = getCustomDomainHostAlias(normalized);
  return alias && alias !== normalized ? [normalized, alias] : [normalized];
}

export function isCustomDomainHostMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeCustomDomainInput(left ?? "");
  const b = normalizeCustomDomainInput(right ?? "");
  if (!a || !b) return false;
  if (a === b) return true;
  return getCustomDomainHostAlias(a) === b || getCustomDomainHostAlias(b) === a;
}

export function getCnameTargetFromEnv(): string | null {
  const appHost = (process.env.NEXT_PUBLIC_APP_URL ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  return appHost && !appHost.startsWith("localhost") ? appHost : null;
}

export function getCustomDomainInstruction(domain: string | null, kind: CustomDomainKind | null, cnameTarget: string | null) {
  if (!domain || !kind) {
    return {
      recordType: "CNAME" as const,
      hostValue: "book",
      targetValue: cnameTarget ?? "your production app hostname",
      helperText: "Use a subdomain such as book.yourstudio.com for the simplest setup.",
    };
  }

  if (kind === "apex") {
    return {
      recordType: "ALIAS / ANAME" as const,
      hostValue: "@",
      targetValue: cnameTarget ?? "your production app hostname",
      helperText:
        "Root domains need provider flattening or ALIAS/ANAME support. If your DNS provider does not support that, use a subdomain instead.",
    };
  }

  return {
    recordType: "CNAME" as const,
    hostValue: domain.split(".")[0] ?? domain,
    targetValue: cnameTarget ?? "your production app hostname",
    helperText:
      "Most providers want only the subdomain label in Host / Name. If your provider asks for a full host name, enter the full domain instead.",
  };
}

function toneForStatus(value: "neutral" | "amber" | "red" | "teal") {
  return value;
}

function labelForCheck(kind: "vercel" | "dns" | "ssl", value: string) {
  if (kind === "vercel") {
    switch (value) {
      case "registered":
        return "Vercel registered";
      case "failed":
        return "Vercel issue";
      case "not_configured":
        return "Not registered";
      default:
        return "Vercel pending";
    }
  }
  if (kind === "dns") {
    switch (value) {
      case "verified":
        return "DNS verified";
      case "misconfigured":
        return "DNS mismatch";
      case "not_configured":
        return "DNS empty";
      default:
        return "DNS pending";
    }
  }
  switch (value) {
    case "ready":
      return "SSL ready";
    case "not_configured":
      return "SSL idle";
    default:
      return "SSL pending";
  }
}

function toneForCheck(value: string) {
  switch (value) {
    case "registered":
    case "verified":
    case "ready":
      return toneForStatus("teal");
    case "failed":
    case "misconfigured":
      return toneForStatus("red");
    case "pending":
    case "unknown":
      return toneForStatus("amber");
    default:
      return toneForStatus("neutral");
  }
}

export function toCustomDomainUiStatus(snapshot: CustomDomainStatusSnapshot): CustomDomainUiStatus {
  let label = "Not configured";
  let detail = "Enter a domain, save it, then add the DNS record shown below.";
  let tone: CustomDomainUiStatus["tone"] = "neutral";

  if (snapshot.domain) {
    if (snapshot.overallStatus === "active") {
      label = "Active";
      detail = "The domain is connected, DNS resolves correctly, and HTTPS is live.";
      tone = "teal";
    } else if (snapshot.vercelStatus === "failed") {
      label = "Registration issue";
      detail = snapshot.lastError || "The app could not register this domain with Vercel yet.";
      tone = "red";
    } else if (snapshot.dnsStatus === "misconfigured") {
      label = "DNS misconfigured";
      detail = snapshot.lastError || "The saved DNS record does not match the required setup.";
      tone = "red";
    } else if (snapshot.sslStatus === "pending") {
      label = "SSL provisioning";
      detail = "DNS looks present, but HTTPS is not ready yet. This usually settles within a few minutes.";
      tone = "amber";
    } else {
      label = "DNS pending";
      detail = "The domain is saved. Finish the DNS step below, then verify again.";
      tone = "amber";
    }
  }

  return {
    ...snapshot,
    label,
    detail,
    tone,
    checks: [
      {
        key: "vercel",
        label: labelForCheck("vercel", snapshot.vercelStatus),
        tone: toneForCheck(snapshot.vercelStatus),
      },
      {
        key: "dns",
        label: labelForCheck("dns", snapshot.dnsStatus),
        tone: toneForCheck(snapshot.dnsStatus),
      },
      {
        key: "ssl",
        label: labelForCheck("ssl", snapshot.sslStatus),
        tone: toneForCheck(snapshot.sslStatus),
      },
    ],
  };
}

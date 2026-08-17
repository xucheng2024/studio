function configuredMarketingHosts() {
  const hosts = new Set<string>();
  const addHost = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      hosts.add(url.hostname.toLowerCase().replace(/\.$/, ""));
    } catch {
      // Invalid configuration stays excluded so CTA redirects fail closed.
    }
  };

  addHost(process.env.NEXT_PUBLIC_APP_URL);
  addHost(process.env.VERCEL_URL);
  for (const host of process.env.MARKETING_CTA_ALLOWED_HOSTS?.split(",") ?? []) addHost(host);
  return hosts;
}

export function isAllowedMarketingCtaUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.port === "" || url.port === "443")
      && configuredMarketingHosts().has(hostname);
  } catch {
    return false;
  }
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Globe, Clock3, ShieldCheck, Loader2 } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  getCustomDomainInstruction,
  getCustomDomainKind,
  normalizeCustomDomainInput,
  type CustomDomainUiStatus,
} from "@/lib/customDomain";
import { ui } from "@/lib/ui";

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={`${ui.btnSecondarySm} whitespace-nowrap ${
        copied
          ? "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300"
          : ""
      }`}
      onClick={async () => {
        const ok = await copyTextToClipboard(value);
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

export function CustomDomainFields({
  studioId,
  initialDomain,
  cnameTarget,
  status,
  remoteStatus,
}: {
  studioId: string;
  initialDomain: string | null;
  cnameTarget: string | null;
  status: CustomDomainUiStatus;
  remoteStatus?: CustomDomainUiStatus | null;
}) {
  const [rawValue, setRawValue] = useState(initialDomain ?? "");
  const [statusState, setStatusState] = useState(status);
  const [verifying, setVerifying] = useState(false);
  const normalized = useMemo(() => normalizeCustomDomainInput(rawValue), [rawValue]);
  const draftKind = getCustomDomainKind(normalized);
  const effectiveDomain = normalized || remoteStatus?.domain || statusState.domain || initialDomain || "";
  const effectiveKind = draftKind ?? statusState.kind;
  const dnsInstruction = getCustomDomainInstruction(effectiveDomain || null, effectiveKind, cnameTarget);
  const savedDomain = remoteStatus?.domain ?? statusState.domain ?? initialDomain ?? "";
  const hasUnsavedDomainChange = normalized !== normalizeCustomDomainInput(savedDomain);
  const openHref = effectiveDomain ? `https://${effectiveDomain}` : null;
  const statusClass =
    statusState.tone === "teal"
      ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/30 dark:text-teal-300"
      : statusState.tone === "red"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
      : statusState.tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
        : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300";
  const checklist = [
    {
      key: "saved",
      label: "Domain saved",
      done: Boolean(savedDomain),
      pending: !savedDomain,
      detail: savedDomain ? savedDomain : "Save the exact domain first.",
    },
    {
      key: "vercel",
      label: "Registered on Vercel",
      done: statusState.vercelStatus === "registered",
      pending: statusState.vercelStatus === "unknown",
      detail:
        statusState.vercelStatus === "registered"
          ? "Domain is registered."
          : statusState.vercelStatus === "failed"
            ? "Registration failed. Check the last error."
            : "Waiting for registration state.",
    },
    {
      key: "dns",
      label: "DNS record correct",
      done: statusState.dnsStatus === "verified",
      pending: statusState.dnsStatus === "pending" || statusState.dnsStatus === "unknown",
      detail:
        statusState.dnsStatus === "verified"
          ? "DNS points to the expected target."
          : statusState.dnsStatus === "misconfigured"
            ? "DNS does not match the record below."
            : "DNS change still needs to propagate.",
    },
    {
      key: "ssl",
      label: "SSL certificate ready",
      done: statusState.sslStatus === "ready",
      pending: statusState.sslStatus === "pending" || statusState.sslStatus === "unknown",
      detail:
        statusState.sslStatus === "ready"
          ? "HTTPS is ready."
          : "SSL is still provisioning or waiting on DNS.",
    },
  ];

  useEffect(() => {
    if (!remoteStatus) return;
    setStatusState(remoteStatus);
    setRawValue(remoteStatus.domain ?? "");
  }, [remoteStatus]);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className={ui.h2}>Custom domain</h2>
        <p className={`mt-0.5 text-xs ${ui.muted}`}>
          Connect your own domain to this studio page. After setup, visitors will stay on your domain.
        </p>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="custom_domain" className={ui.label}>Domain</label>
        <input
          id="custom_domain"
          name="custom_domain"
          type="text"
          className={`${ui.input} font-mono text-sm`}
          value={rawValue}
          onChange={(e) => setRawValue(e.target.value)}
          placeholder="book.yourstudio.com"
          maxLength={253}
        />
        <p className={`text-xs ${ui.muted}`}>
          Enter the exact domain customers should visit, such as <span className={ui.code}>www.example.com</span> or <span className={ui.code}>book.example.com</span>. Do not include <span className={ui.code}>https://</span>.
        </p>
        {draftKind === "apex" ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Root domains need provider-specific ALIAS/ANAME flattening. If you want the simplest setup, use <span className={ui.code}>book.{normalized}</span> instead.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-950/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Globe size={15} />
            Step 1
          </div>
          <p className={`mt-2 text-xs ${ui.muted}`}>
            Enter the domain you want to use for this studio page, then click <strong>Save domain</strong>.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-950/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <ShieldCheck size={15} />
            Step 2
          </div>
          <p className={`mt-2 text-xs ${ui.muted}`}>
            Add the DNS record shown below at your DNS provider. Saving here also registers the domain on Vercel and stores the live verification state.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-950/40">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
            <Clock3 size={15} />
            Step 3
          </div>
          <p className={`mt-2 text-xs ${ui.muted}`}>
            Wait for DNS and SSL. Registration is usually immediate, but activation can take a few minutes and sometimes up to 30 minutes.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
          {statusState.label}
        </span>
        <p className={`text-xs ${ui.muted}`}>{statusState.detail}</p>
        {effectiveDomain ? (
          <button
            type="button"
            disabled={verifying || hasUnsavedDomainChange}
            className={`${ui.btnSecondarySm} ml-auto`}
            onClick={async () => {
              if (hasUnsavedDomainChange) return;
              setVerifying(true);
              try {
                const res = await fetch("/api/dashboard/custom-domain/verify", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ studio_id: studioId, domain: effectiveDomain }),
                });
                const body = await res.json().catch(() => null) as { status?: CustomDomainUiStatus } | null;
                if (res.ok && body?.status) {
                  setStatusState(body.status);
                }
              } finally {
                setVerifying(false);
              }
            }}
          >
            {verifying ? <Loader2 size={13} className="animate-spin" /> : null}
            {hasUnsavedDomainChange ? "Save first to verify" : verifying ? "Verifying..." : "Verify now"}
          </button>
        ) : null}
      </div>
      {hasUnsavedDomainChange ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Save this domain change first, then run verification against the saved value.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {statusState.checks.map((check) => (
          <span
            key={check.key}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              check.tone === "teal"
                ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/30 dark:text-teal-300"
                : check.tone === "red"
                  ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
                  : check.tone === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
                    : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300"
            }`}
          >
            {check.label}
          </span>
        ))}
        {statusState.lastVerifiedAt ? (
          <span className={`text-xs ${ui.muted}`}>
            Last checked: {new Date(statusState.lastVerifiedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950/40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Current setup</p>
          <p className={`text-xs ${ui.muted}`}>Work down this checklist until the domain becomes active.</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {checklist.map((item) => (
            <div key={item.key} className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/40">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    item.done
                      ? "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                      : item.pending
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                  }`}
                >
                  {item.done ? "Done" : item.pending ? "Pending" : "Needs action"}
                </span>
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{item.label}</p>
              </div>
              <p className={`mt-2 text-xs ${ui.muted}`}>{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {statusState.lastError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/40 dark:bg-red-950/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">Last error</p>
          <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300">{statusState.lastError}</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-dashed border-stone-300 p-4 dark:border-stone-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">DNS record to add</p>
            <p className={`mt-1 text-xs ${ui.muted}`}>
              {effectiveKind === "apex"
                ? "Add this root-domain record after saving. Exact naming varies by provider."
                : "Add this at your DNS provider after saving the domain here."}
            </p>
          </div>
          {cnameTarget ? <CopyValueButton value={cnameTarget} label="Copy target" /> : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${ui.muted}`}>Type</p>
            <p className="mt-1 font-mono text-sm text-stone-900 dark:text-stone-100">{dnsInstruction.recordType}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${ui.muted}`}>Host / Name</p>
            <p className="mt-1 break-all font-mono text-sm text-stone-900 dark:text-stone-100">
              {dnsInstruction.hostValue}
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950/40">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${ui.muted}`}>Target</p>
            <p className="mt-1 break-all font-mono text-sm text-stone-900 dark:text-stone-100">
              {dnsInstruction.targetValue}
            </p>
          </div>
        </div>

        <p className={`mt-3 text-xs ${ui.muted}`}>
          {dnsInstruction.helperText}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-950/40">
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Troubleshooting</p>
        <ul className={`mt-2 list-disc space-y-1 pl-5 text-xs ${ui.muted}`}>
          <li>Do not include <span className={ui.code}>https://</span> in the domain field.</li>
          <li>Double-check that the DNS target matches the value shown above exactly.</li>
          <li>If you use a root domain, your provider must support ALIAS/ANAME or flattening.</li>
          <li>If the domain is not live after 30 minutes, recheck the DNS record and SSL status.</li>
          <li>Leave the field blank and save if you want to remove the custom domain.</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className={ui.btnSecondarySm}
            >
              Open domain
            </a>
          ) : null}
          {effectiveDomain ? <CopyValueButton value={effectiveDomain} label="Copy domain" /> : null}
        </div>
      </div>
    </div>
  );
}

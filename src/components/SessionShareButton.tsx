"use client";

import { useState } from "react";
import { Link2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { ui } from "@/lib/ui";

export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        className={`${ui.btnSecondarySm} disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          setIsError(false);
          setCopied(false);
          const res = await fetch("/api/dashboard/share-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity_type: "session", entity_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(body.error ?? "Could not build link");
            setIsError(true);
            return;
          }
          if (body.url) {
            try {
              await navigator.clipboard.writeText(body.url);
              setMsg("Copied session link");
              setCopied(true);
            } catch {
              setMsg(body.url);
            }
          }
        }}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : copied ? (
          <CheckCircle2 size={12} />
        ) : (
          <Link2 size={12} />
        )}
        {busy ? "Getting link…" : copied ? "Copied!" : "Copy session link"}
      </button>
      {msg && !copied ? (
        <p className={`flex items-center gap-1 text-xs ${isError ? "text-red-600 dark:text-red-400" : ui.muted}`}>
          {isError ? <AlertCircle size={11} /> : null}
          {msg}
        </p>
      ) : null}
    </div>
  );
}

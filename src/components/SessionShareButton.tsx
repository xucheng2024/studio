"use client";

import { useState } from "react";
import { Link2, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={async () => {
        setBusy(true);
        setCopied(false);
        const res = await fetch("/api/dashboard/share-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entity_type: "session", entity_id: sessionId }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          toast.error(body.error ?? "Could not build link");
          return;
        }
        if (body.url) {
          try {
            await navigator.clipboard.writeText(body.url);
            setCopied(true);
            toast.success("Session link copied");
            setTimeout(() => setCopied(false), 2500);
          } catch {
            toast.info(body.url);
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
  );
}

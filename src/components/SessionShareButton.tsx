"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function SessionShareButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        className={`${ui.btnSecondarySm} disabled:opacity-50`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/dashboard/share-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entity_type: "session", entity_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(body.error ?? "Could not build link");
            return;
          }
          if (body.url) {
            await navigator.clipboard.writeText(body.url);
            setMsg("Copied session link");
          }
        }}
      >
        {busy ? "Copying..." : "Copy session link"}
      </button>
      {msg ? <p className={`text-xs ${ui.muted}`}>{msg}</p> : null}
    </div>
  );
}

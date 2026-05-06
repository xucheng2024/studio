"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Props = {
  serviceId: string;
};

export function ServiceDetailLinkButton({ serviceId }: Props) {
  const [busy, setBusy] = useState(false);

  const copyDetailLink = async () => {
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "service", entity_id: serviceId }),
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
        toast.success("Service link copied");
      } catch {
        toast.info(body.url);
      }
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={`${ui.btnSecondarySm} disabled:opacity-50`}
      onClick={() => void copyDetailLink()}
    >
      <Copy size={13} />
      Copy detail link
    </button>
  );
}

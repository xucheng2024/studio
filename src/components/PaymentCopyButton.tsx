"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function PaymentCopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={ui.linkMuted}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
    >
      {ok ? "Copied" : "Copy details"}
    </button>
  );
}

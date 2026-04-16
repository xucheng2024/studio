"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function CopyRefButton({ reference }: { reference: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className={ui.btnSecondarySm}
      onClick={async () => {
        await navigator.clipboard.writeText(reference);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : "Copy reference"}
    </button>
  );
}

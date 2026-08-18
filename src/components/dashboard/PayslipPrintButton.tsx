"use client";

import { ui } from "@/lib/ui";

export function PayslipPrintButton() {
  return (
    <button type="button" className={ui.btnSecondarySm} onClick={() => window.print()}>
      Print
    </button>
  );
}

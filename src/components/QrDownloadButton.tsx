"use client";

import { useState } from "react";
import { Check, Download } from "lucide-react";
import { ui } from "@/lib/ui";

type Props = {
  dataUrl: string;
  amount: string;
};

/**
 * Lets users save the PayNow QR image to their device.
 * Uses <a download> which triggers native "Save to Photos" on iOS Safari
 * and a file download on Android / desktop.
 */
export function QrDownloadButton({ dataUrl, amount }: Props) {
  const [saved, setSaved] = useState(false);

  const handleClick = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <a
        href={dataUrl}
        download={`paynow-${amount.replace(/\s/g, "-")}.png`}
        className={`${ui.btnSecondarySm} ${saved ? "border-teal-300 text-teal-700 dark:border-teal-700 dark:text-teal-300" : ""}`}
        onClick={handleClick}
      >
        {saved ? <Check size={13} /> : <Download size={13} />}
        {saved ? "Saved!" : "Save QR to Photos"}
      </a>
      <p className="text-xs text-stone-400 dark:text-stone-500">
        Or long-press the QR image to save
      </p>
    </div>
  );
}

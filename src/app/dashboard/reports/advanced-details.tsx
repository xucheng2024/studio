"use client";

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "reports:advanced-details-open";

type Props = {
  className?: string;
  summary: ReactNode;
  children: ReactNode;
};

export default function AdvancedDetails({ className, summary, children }: Props) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      setOpen(saved === "1");
    } catch {
      setOpen(false);
    } finally {
      setReady(true);
    }
  }, []);

  return (
    <details
      className={className}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        } catch {}
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-stone-800 dark:text-stone-200">
        {summary}
      </summary>
      {!ready ? null : children}
    </details>
  );
}

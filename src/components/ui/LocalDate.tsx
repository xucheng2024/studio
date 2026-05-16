"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLocalDate } from "@/lib/date";

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
};

/**
 * Renders a date-only string.
 * SSR/initial render: Singapore Time (SGT) as fallback.
 * After hydration: switches to the viewer's browser local timezone.
 */
export function LocalDate({
  iso,
  options,
}: {
  iso: string | null | undefined;
  options?: Intl.DateTimeFormatOptions;
}) {
  const optionsKey = useMemo(
    () => JSON.stringify(options ?? DEFAULT_DATE_OPTIONS),
    [options],
  );
  const opts = useMemo<Intl.DateTimeFormatOptions>(
    () => JSON.parse(optionsKey) as Intl.DateTimeFormatOptions,
    [optionsKey],
  );
  const sgt = formatLocalDate(iso, opts);
  const [label, setLabel] = useState(sgt);

  useEffect(() => {
    // Keep SSR fallback in sync when iso/options change before local reformat.
    setLabel(sgt);
  }, [sgt]);

  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setLabel(d.toLocaleDateString(undefined, opts));
  }, [iso, opts]);

  if (!iso) return null;
  return <span suppressHydrationWarning>{label}</span>;
}

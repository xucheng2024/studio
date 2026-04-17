"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ui } from "@/lib/ui";

export function StudioSwitcher({
  studios,
  selectedStudioId = null,
}: {
  studios: { id: string; name: string }[];
  selectedStudioId?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const cookieStudio = useMemo(() => {
    if (typeof document === "undefined") return null;
    const hit = document.cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("last_studio_id="));
    return hit ? decodeURIComponent(hit.split("=")[1] ?? "") : null;
  }, []);
  const activeStudioId = selectedStudioId ?? search.get("studio_id") ?? cookieStudio ?? "all";

  return (
    <label className="flex w-full min-w-0 flex-col gap-1 text-xs text-stone-500">
      <span>Studio</span>
      <select
        className={`${ui.select} h-8 w-full min-w-0 py-1 text-xs`}
        value={activeStudioId}
        onChange={(e) => {
          const params = new URLSearchParams(search.toString());
          if (e.target.value === "all") {
            params.delete("studio_id");
            params.delete("location_id");
            document.cookie = "last_studio_id=; path=/; max-age=0";
            document.cookie = "last_location_id=; path=/; max-age=0";
          } else {
            params.set("studio_id", e.target.value);
            params.delete("location_id");
            document.cookie = `last_studio_id=${encodeURIComponent(e.target.value)}; path=/; max-age=2592000`;
            document.cookie = "last_location_id=; path=/; max-age=0";
          }
          const q = params.toString();
          router.push(q ? `${pathname}?${q}` : pathname);
        }}
      >
        <option value="all">All studios</option>
        {studios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

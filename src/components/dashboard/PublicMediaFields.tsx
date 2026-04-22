"use client";

import { useState } from "react";
import { PublicMediaUploader } from "@/components/dashboard/PublicMediaUploader";
import { ui } from "@/lib/ui";

type CoverFieldProps = {
  studioId: string;
  entityId: string;
  folder: "studios" | "services";
  name: string;
  label: string;
  defaultValue: string | null;
};

export function CoverUrlField({ studioId, entityId, folder, name, label, defaultValue }: CoverFieldProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <input type="hidden" name={name} value={value} />
      <PublicMediaUploader
        studioId={studioId}
        folder={folder}
        entityId={entityId}
        label={value ? "Replace image" : "Upload image"}
        onUploaded={(url) => setValue(url)}
      />
      {value ? (
        <div className="mt-1 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="h-28 w-full rounded-lg border border-stone-200 object-cover dark:border-stone-700" />
          <button type="button" className={ui.btnGhost} onClick={() => setValue("")}>
            Remove image
          </button>
        </div>
      ) : null}
    </div>
  );
}

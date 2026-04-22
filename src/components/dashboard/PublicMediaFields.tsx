"use client";

import { useMemo, useState } from "react";
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
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={ui.input}
        placeholder="https://..."
      />
      <PublicMediaUploader
        studioId={studioId}
        folder={folder}
        entityId={entityId}
        onUploaded={(url) => setValue(url)}
      />
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-1 h-28 w-full rounded-lg border border-stone-200 object-cover dark:border-stone-700" />
      ) : null}
    </label>
  );
}

type GalleryFieldProps = {
  studioId: string;
  entityId: string;
  folder: "studios" | "services";
  name: string;
  label: string;
  defaultValue: string[];
};

export function GalleryJsonField({ studioId, entityId, folder, name, label, defaultValue }: GalleryFieldProps) {
  const [items, setItems] = useState<string[]>(defaultValue);
  const [raw, setRaw] = useState(() => JSON.stringify(defaultValue, null, 2));
  const jsonValue = useMemo(() => JSON.stringify(items, null, 2), [items]);

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>{label} (JSON array)</span>
      <textarea
        name={name}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
        }}
        onBlur={() => {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const next = parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
              setItems(next);
              setRaw(JSON.stringify(next, null, 2));
            }
          } catch {
            setRaw(jsonValue);
          }
        }}
        rows={5}
        className={`${ui.input} min-h-28 font-mono text-xs`}
      />
      <PublicMediaUploader
        studioId={studioId}
        folder={folder}
        entityId={entityId}
        label="Upload and append"
        onUploaded={(url) =>
          setItems((prev) => {
            const next = [...prev, url];
            setRaw(JSON.stringify(next, null, 2));
            return next;
          })
        }
      />
      {items.length ? (
        <div className="mt-1 grid grid-cols-3 gap-2">
          {items.slice(0, 6).map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="h-16 w-full rounded border border-stone-200 object-cover dark:border-stone-700" />
          ))}
        </div>
      ) : null}
    </label>
  );
}

"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { COVER_MAX_BYTES } from "@/lib/coverMedia";
import { ui } from "@/lib/ui";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Props = {
  studioId: string;
  folder: "studios" | "services" | "classes" | "packages" | "events";
  entityId: string;
  label?: string;
  onUploaded: (url: string) => void;
};

export function PublicMediaUploader({ studioId, folder, entityId, label = "Upload image", onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | null | undefined) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      toast.error("Use JPG, PNG, or WebP.");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      toast.error("Image must be 5MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("studio_id", studioId);
      fd.set("folder", folder);
      fd.set("entity_id", entityId);
      fd.set("file", file);
      const res = await fetch("/api/dashboard/media/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        toast.error(body.error ?? "Upload failed");
        return;
      }
      onUploaded(body.url);
      toast.success("Image uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={ui.btnSecondarySm}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        {busy ? "Uploading..." : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          void onPick(file);
        }}
      />
    </div>
  );
}

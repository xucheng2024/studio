"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { COVER_MAX_BYTES } from "@/lib/coverMedia";
import { ui } from "@/lib/ui";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const cw = Math.round(width * scale);
      const ch = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      const outMime = file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg";
      canvas.toBlob((blob) => resolve(blob ?? file), outMime, quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

type Props = {
  studioId: string;
  folder: "studios" | "services" | "classes" | "packages" | "events" | "member-zone";
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
      const compressed = await compressImage(file);
      const uploadFile = compressed.size < file.size ? compressed : file;
      const fd = new FormData();
      fd.set("studio_id", studioId);
      fd.set("folder", folder);
      fd.set("entity_id", entityId);
      fd.set(
        "file",
        uploadFile instanceof File ? uploadFile : new File([uploadFile], file.name, { type: uploadFile.type }),
      );
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

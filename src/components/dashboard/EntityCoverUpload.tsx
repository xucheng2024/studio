"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { COVER_MAX_BYTES } from "@/lib/coverMedia";
import { ui } from "@/lib/ui";

/**
 * Resize + compress an image file using an off-screen canvas.
 * - Caps longest edge at maxDim (default 1920px) while preserving aspect ratio.
 * - Outputs JPEG at `quality` (0–1). PNG/WebP with transparency fall back to
 *   WebP so the alpha channel is preserved.
 * - Returns the compressed Blob; falls back to the original File on any error.
 */
async function compressImage(file: File, maxDim = 1920, quality = 0.85): Promise<Blob> {
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
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, cw, ch);
      // Preserve alpha for PNG/WebP; use JPEG for opaque photos (smaller files).
      const outMime = file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg";
      canvas.toBlob((blob) => resolve(blob ?? file), outMime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type Props = {
  entity: "class" | "package";
  entityId: string;
  imageUrl: string | null;
  canEdit: boolean;
};

export function EntityCoverUpload({ entity, entityId, imageUrl: initialUrl, canEdit }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { setImageUrl(initialUrl); }, [initialUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const apiBase = entity === "class"
    ? `/api/dashboard/classes/${entityId}/image`
    : `/api/dashboard/packages/${entityId}/image`;

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > COVER_MAX_BYTES) { setError("Image must be 5MB or smaller."); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Use JPG, PNG, or WebP."); return; }
    setBusy(true);
    try {
      // Compress + resize client-side before upload (keeps storage small).
      const compressed = await compressImage(file);
      const uploadFile = compressed.size < file.size ? compressed : file;

      const fd = new FormData();
      fd.set("file", uploadFile instanceof File ? uploadFile : new File([uploadFile], file.name, { type: uploadFile.type }));
      const res = await fetch(apiBase, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error === "file_too_large" ? "Image must be 5MB or smaller." : (body.error ?? "Upload failed")); return; }
      if (body.image_url) setImageUrl(body.image_url);
      setToast("Cover updated");
      router.refresh();
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(apiBase, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "Remove failed"); return; }
      setImageUrl(null);
      setToast("Cover removed");
      router.refresh();
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  };

  // Read-only preview for non-editors
  if (!canEdit) {
    if (!imageUrl) return null;
    return (
      <div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
        <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {imageUrl ? (
        /* Has cover: show image with hover overlay for quick re-upload */
        <button
          type="button"
          disabled={busy}
          className="group relative w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900"
          onClick={() => !busy && inputRef.current?.click()}
          aria-label="Replace cover image"
        >
          <div className="aspect-video w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="size-full object-cover transition-opacity group-hover:opacity-80" loading="lazy" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {busy ? "Uploading…" : "Replace"}
            </span>
          </div>
        </button>
      ) : (
        /* No cover: dashed upload zone */
        <button
          type="button"
          disabled={busy}
          className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 transition-colors hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/30 dark:hover:border-stone-600 disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          aria-label="Upload cover image"
        >
          {busy ? (
            <Loader2 size={24} className="animate-spin text-stone-400" />
          ) : (
            <ImageIcon size={24} className="text-stone-400" />
          )}
          <span className={`text-sm font-medium ${ui.muted}`}>
            {busy ? "Uploading…" : "Click to add cover image"}
          </span>
          <span className={`text-xs ${ui.muted}`}>JPG, PNG or WebP · max 5MB</span>
        </button>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(ev) => void onPickFile(ev)} />

      {/* Action row: only show Remove when there is a cover */}
      {imageUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} disabled:opacity-50`}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={13} />
            Replace cover
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} border-red-200 text-red-700 dark:border-red-800 dark:text-red-300 disabled:opacity-50`}
            onClick={() => void onRemove()}
          >
            <Trash2 size={13} />
            Remove
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle size={12} />{error}
        </p>
      ) : null}
      {toast ? (
        <p className="flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400">
          <CheckCircle2 size={12} />{toast}
        </p>
      ) : null}
    </div>
  );
}

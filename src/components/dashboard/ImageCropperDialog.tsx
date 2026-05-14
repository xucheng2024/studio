"use client";

import { useEffect, useRef, useState } from "react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type Props = {
  file: File;
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
  /** Crop aspect ratio. Defaults to 16/9 for cover images. Pass 1 for logos. */
  cropAspect?: number;
};

async function exportCroppedImage(
  img: HTMLImageElement,
  crop: Crop,
  file: File,
  cropAspect: number,
): Promise<File> {
  const OUT_W = cropAspect === 1 ? 800 : 1200;
  const OUT_H = cropAspect === 1 ? 800 : 675;

  const scaleX = img.naturalWidth / img.width;
  const scaleY = img.naturalHeight / img.height;

  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    OUT_W,
    OUT_H,
  );

  const outType =
    cropAspect === 1
      ? "image/png"
      : file.type === "image/png" || file.type === "image/webp"
        ? "image/webp"
        : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
  if (!blob) throw new Error("encode_failed");
  return new File([blob], file.name, { type: outType });
}

function defaultCrop(width: number, height: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height),
    width,
    height,
  );
}

export function ImageCropperDialog({ file, open, onCancel, onConfirm, cropAspect = 16 / 9 }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSrc(null);
    setCrop(undefined);
    imgRef.current = null;
    const reader = new FileReader();
    reader.onload = () => {
      if (!active) return;
      const value = typeof reader.result === "string" ? reader.result : null;
      setSrc(value);
    };
    reader.onerror = () => {
      if (!active) return;
      toast.error("Image preview failed to load. Please try another JPG/PNG/WebP file.");
    };
    reader.readAsDataURL(file);
    return () => { active = false; };
  }, [file, open]);

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget;
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(defaultCrop(naturalWidth, naturalHeight, cropAspect));
  };

  const handleReset = () => {
    if (!imgRef.current) return;
    const { naturalWidth, naturalHeight } = imgRef.current;
    setCrop(defaultCrop(naturalWidth, naturalHeight, cropAspect));
  };

  const handleConfirm = async () => {
    if (!src || !crop || !imgRef.current || busy) return;
    setBusy(true);
    try {
      const output = await exportCroppedImage(imgRef.current, crop, file, cropAspect);
      onConfirm(output);
    } catch (err) {
      toast.error("Failed to process image. Please try again.");
      console.error("[crop]", err);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-200 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-stone-900 sm:max-h-[95vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center border-b border-stone-200 px-4 py-3 dark:border-stone-700">
          <span className="text-sm font-semibold">
            Crop image ({cropAspect === 1 ? "1:1" : "16:9"})
          </span>
          <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">
            Drag the box to adjust
          </span>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-col items-center gap-4 overflow-y-auto p-4">
          {src ? (
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              aspect={cropAspect}
              minWidth={40}
              minHeight={40}
              className="max-h-[60vh] max-w-full overflow-hidden rounded-lg"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="Crop preview"
                onLoad={onImageLoad}
                className="block max-h-[60vh] max-w-full object-contain"
                style={{ display: "block" }}
              />
            </ReactCrop>
          ) : (
            <div className="flex h-40 w-full items-center justify-center text-xs text-stone-400">
              Loading…
            </div>
          )}
        </div>

        {/* Footer — always visible */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-stone-200 px-4 py-3 dark:border-stone-700">
          <button type="button" className={ui.btnSecondarySm} onClick={handleReset} disabled={busy || !src}>
            Reset
          </button>
          <button type="button" className={ui.btnSecondarySm} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`${ui.btnPrimarySm} disabled:opacity-50`}
            onClick={() => void handleConfirm()}
            disabled={busy || !src || !crop}
          >
            {busy ? "Processing…" : "Use this crop"}
          </button>
        </div>
      </div>
    </div>
  );
}

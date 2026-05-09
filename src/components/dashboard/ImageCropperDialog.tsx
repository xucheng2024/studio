"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
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

async function exportCroppedImage(src: string, crop: Area, file: File, cropAspect: number): Promise<File> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load_failed"));
    img.src = src;
  });

  const OUT_W = cropAspect === 1 ? 800 : 1200;
  const OUT_H = cropAspect === 1 ? 800 : 675;

  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    OUT_W,
    OUT_H,
  );

  const outType = cropAspect === 1
    ? "image/png"
    : (file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
  if (!blob) throw new Error("encode_failed");
  return new File([blob], file.name, { type: outType });
}

export function ImageCropperDialog({ file, open, onCancel, onConfirm, cropAspect = 16 / 9 }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);

  useEffect(() => {
    let active = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (!active) return;
      const value = typeof reader.result === "string" ? reader.result : null;
      setSrc(value);
    };
    reader.onerror = () => {
      if (!active) return;
      setSrc(null);
      toast.error("Image preview failed to load. Please try another JPG/PNG/WebP file.");
    };
    reader.readAsDataURL(file);
    return () => {
      active = false;
    };
  }, [file]);
  useEffect(() => {
    setMediaReady(false);
  }, [src]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCropPixels(areaPixels);
  }, []);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleConfirm = async () => {
    if (!src || !cropPixels || busy) return;
    setBusy(true);
    try {
      const output = await exportCroppedImage(src, cropPixels, file, cropAspect);
      onConfirm(output);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-2xl dark:bg-stone-900">
        <div className="mb-2 text-sm font-semibold">Crop image ({cropAspect === 1 ? "1:1" : "16:9"})</div>
        <div
          className={cropAspect === 1
            ? "relative mx-auto aspect-square w-full max-w-[420px] rounded-lg border border-stone-300 bg-[linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%,#f5f5f4),linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%,#f5f5f4)] [background-position:0_0,8px_8px] [background-size:16px_16px] dark:border-stone-600 dark:bg-[linear-gradient(45deg,#44403c_25%,transparent_25%,transparent_75%,#44403c_75%,#44403c),linear-gradient(45deg,#44403c_25%,transparent_25%,transparent_75%,#44403c_75%,#44403c)]"
            : "relative mx-auto h-[320px] w-full max-w-2xl rounded-lg border border-stone-300 bg-[linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%,#f5f5f4),linear-gradient(45deg,#f5f5f4_25%,transparent_25%,transparent_75%,#f5f5f4_75%,#f5f5f4)] [background-position:0_0,8px_8px] [background-size:16px_16px] dark:border-stone-600 dark:bg-[linear-gradient(45deg,#44403c_25%,transparent_25%,transparent_75%,#44403c_75%,#44403c),linear-gradient(45deg,#44403c_25%,transparent_25%,transparent_75%,#44403c_75%,#44403c)]"
          }
        >
          {src ? (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={3}
              aspect={cropAspect}
              restrictPosition
              objectFit="contain"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              onMediaLoaded={() => setMediaReady(true)}
              mediaProps={{
                onError: () => {
                  setMediaReady(false);
                  toast.error("Image preview failed to load. Please try another JPG/PNG/WebP file.");
                },
              }}
              style={{
                containerStyle: { borderRadius: "0.5rem" },
              }}
            />
          ) : null}
        </div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-stone-600 dark:text-stone-300">Zoom</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={ui.btnSecondarySm} onClick={handleReset} disabled={busy}>Reset</button>
          <button type="button" className={ui.btnSecondarySm} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={ui.btnPrimarySm} onClick={() => void handleConfirm()} disabled={busy || !src || !cropPixels || !mediaReady}>Use this crop</button>
        </div>
      </div>
    </div>
  );
}

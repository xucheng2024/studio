import sharp from "sharp";

type NormalizeVariant = "cover" | "logo" | "square";

export async function normalizeCoverImage(
  input: Buffer,
  sourceMime: string,
  variant: NormalizeVariant = "cover",
): Promise<{ buffer: Buffer; mime: string; ext: "jpg" | "webp" }> {
  const keepAlpha = sourceMime === "image/png" || sourceMime === "image/webp";
  const mime = keepAlpha ? "image/webp" : "image/jpeg";
  const ext = keepAlpha ? "webp" : "jpg";

  const pipeline = sharp(input, { failOn: "none" }).rotate();
  if (variant === "logo") {
    pipeline.resize(800, 800, {
      fit: "contain",
      position: "centre",
      background: keepAlpha
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { r: 255, g: 255, b: 255, alpha: 1 },
    });
  } else if (variant === "square") {
    pipeline.resize(1200, 1200, { fit: "cover", position: "centre" });
  } else {
    pipeline.resize(1200, 675, { fit: "cover", position: "centre" });
  }

  const buffer = mime === "image/webp"
    ? await pipeline.webp({ quality: 85 }).toBuffer()
    : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  return { buffer, mime, ext };
}

const OPTIONAL_SUPABASE_SERVICES = new Set([
  "realtime",
  "storage-api",
  "imgproxy",
  "mailpit",
  "postgres-meta",
  "studio",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
]);

export function supabaseStartExcludeArgs(value) {
  if (!value) return [];
  const services = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  const invalid = services.filter((service) => !OPTIONAL_SUPABASE_SERVICES.has(service));
  if (invalid.length > 0) {
    throw new Error(`UAT_SUPABASE_EXCLUDE contains unsupported services: ${invalid.join(",")}`);
  }
  return services.length === 0 ? [] : ["--exclude", services.join(",")];
}

export function validateDockerImageList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error("Supabase Docker image manifest must contain 1-32 images");
  }
  const images = [...new Set(value)];
  for (const image of images) {
    if (typeof image !== "string" || image.length > 300 || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:+-]*$/.test(image)) {
      throw new Error("Supabase Docker image manifest contains an invalid image reference");
    }
  }
  return images;
}

export function normalizePublicTags(input: string[] | null | undefined): string[] | null {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const tags = raw
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, 32))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  return tags.length ? tags : null;
}

export function parsePublicTagsInput(raw: FormDataEntryValue | string | null | undefined): string[] | null {
  const text = String(raw ?? "");
  return normalizePublicTags(text.split(/[\n,，]+/));
}

export function formatPublicTagsInput(tags: string[] | null | undefined): string {
  return Array.isArray(tags) ? tags.join("\n") : "";
}

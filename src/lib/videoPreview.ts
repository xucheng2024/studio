export type VideoPreview = {
  provider: "youtube" | "unknown";
  videoId: string | null;
  thumbnailUrl: string | null;
};

function parseYoutubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] ?? "";
      return id || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v") ?? "";
        return id || null;
      }
      if (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/embed/")) {
        const id = u.pathname.split("/")[2] ?? "";
        return id || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function getVideoPreview(rawUrl: string | null | undefined): VideoPreview {
  const url = String(rawUrl ?? "").trim();
  if (!url) return { provider: "unknown", videoId: null, thumbnailUrl: null };
  const youtubeId = parseYoutubeId(url);
  if (youtubeId) {
    return {
      provider: "youtube",
      videoId: youtubeId,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }
  return { provider: "unknown", videoId: null, thumbnailUrl: null };
}

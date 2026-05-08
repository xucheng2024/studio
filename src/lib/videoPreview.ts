export type VideoPreview = {
  provider: "youtube" | "vimeo" | "mux" | "unknown";
  videoId: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
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

function parseVimeoId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const id = parts.reverse().find((p) => /^[0-9]+$/.test(p)) ?? "";
    return id || null;
  } catch {
    return null;
  }
}

function parseMuxId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "player.mux.com" && host !== "stream.mux.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const id = (parts[0] ?? "").split(".")[0] ?? "";
    return id || null;
  } catch {
    return null;
  }
}

export function getVideoPreview(rawUrl: string | null | undefined): VideoPreview {
  const url = String(rawUrl ?? "").trim();
  if (!url) return { provider: "unknown", videoId: null, thumbnailUrl: null, embedUrl: null };
  const youtubeId = parseYoutubeId(url);
  if (youtubeId) {
    return {
      provider: "youtube",
      videoId: youtubeId,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
    };
  }
  const vimeoId = parseVimeoId(url);
  if (vimeoId) {
    return {
      provider: "vimeo",
      videoId: vimeoId,
      thumbnailUrl: null,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
    };
  }
  const muxId = parseMuxId(url);
  if (muxId) {
    return {
      provider: "mux",
      videoId: muxId,
      thumbnailUrl: `https://image.mux.com/${muxId}/thumbnail.webp?width=1200&height=675&fit_mode=preserve`,
      embedUrl: `https://player.mux.com/${muxId}`,
    };
  }
  return { provider: "unknown", videoId: null, thumbnailUrl: null, embedUrl: null };
}

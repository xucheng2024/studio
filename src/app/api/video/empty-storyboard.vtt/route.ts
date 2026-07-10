export const dynamic = "force-static";

export function GET() {
  return new Response("WEBVTT\n\n", {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/vtt; charset=utf-8",
    },
  });
}

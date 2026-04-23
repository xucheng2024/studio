/** Detect embedded / in-app browsers where OAuth is often blocked. */
export function detectInAppBrowser(): { isInApp: boolean; name: string } {
  if (typeof navigator === "undefined") return { isInApp: false, name: "" };
  const ua = navigator.userAgent;
  if (/MicroMessenger/i.test(ua)) return { isInApp: true, name: "WeChat" };
  if (/FBAV|FBAN/i.test(ua)) return { isInApp: true, name: "Facebook" };
  if (/Instagram/i.test(ua)) return { isInApp: true, name: "Instagram" };
  if (/Line\//i.test(ua)) return { isInApp: true, name: "Line" };
  if (/TikTok/i.test(ua)) return { isInApp: true, name: "TikTok" };
  if (/Twitter/i.test(ua)) return { isInApp: true, name: "Twitter" };
  if (/wv\)/i.test(ua) && /Android/i.test(ua)) return { isInApp: true, name: "in-app browser" };
  return { isInApp: false, name: "" };
}

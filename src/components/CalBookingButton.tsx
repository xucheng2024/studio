"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Cal?: any;
  }
}

interface Props {
  calLink: string;
  label?: string;
  className?: string;
}

export function CalBookingButton({ calLink, label = "Book a session", className }: Props) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (window.Cal?.loaded) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (a: any, ar: any) => { a.q.push(ar); };
    const d = document;
    if (!window.Cal) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.Cal = function (...args: any[]) {
        const cal = window.Cal!;
        if (args[0] === "init") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const api: any = (...a: unknown[]) => p(api, a);
          const namespace = args[1];
          api.q = api.q || [];
          if (typeof namespace === "string") {
            cal.ns = cal.ns || {};
            cal.ns[namespace] = cal.ns[namespace] || api;
            p(cal.ns[namespace], args);
            p(cal, ["init", namespace, args[2]]);
          } else {
            p(cal, args);
          }
          return;
        }
        p(cal, args);
      };
      window.Cal.q = [];
      window.Cal.ns = {};
    }

    window.Cal("ui", {
      styles: { branding: { brandColor: "#0d9488" } },
      hideEventTypeDetails: true,
      layout: "month_view",
    });

    const s = d.createElement("script");
    s.src = "https://app.cal.com/embed/embed.js";
    s.async = true;
    d.head.appendChild(s);
    window.Cal.loaded = true;

    const onMessage = (e: MessageEvent) => {
      if (e.data?.__isCalComEmbed) setLoading(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function handleClick() {
    setLoading(true);
    setTimeout(() => setLoading(false), 5000);
  }

  return (
    <>
      <link rel="preconnect" href="https://app.cal.com" />
      <button
        data-cal-link={calLink.replace(/^https?:\/\/cal\.com\//, "")}
        data-cal-config='{"layout":"month_view"}'
        className={className}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? (
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.8" aria-hidden>
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M4 10h16" />
          </svg>
        )}
        {loading ? "Opening..." : label}
      </button>
    </>
  );
}

import type { NextConfig } from "next";

// Extract hostname from NEXT_PUBLIC_SUPABASE_URL for remote image patterns.
// Handles both *.supabase.co and custom domains (e.g. db.example.com).
function supabaseHostname(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

const host = supabaseHostname();

const pdfFontFiles = [
  "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
  "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff",
  "./node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff",
  "./node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-700-normal.woff",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/invoice/*": pdfFontFiles,
    "/api/payroll/payslip/*": pdfFontFiles,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Generic *.supabase.co projects
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      // Mux video thumbnails
      {
        protocol: "https",
        hostname: "image.mux.com",
      },
      // YouTube video thumbnails
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      // Vimeo video thumbnails
      {
        protocol: "https",
        hostname: "i.vimeocdn.com",
      },
      // Custom-domain Supabase deployments (read from env at build time)
      ...(host && !host.endsWith(".supabase.co")
        ? [
            {
              protocol: "https" as const,
              hostname: host,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;

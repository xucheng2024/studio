import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import "react-international-phone/style.css";
import { SiteHeader } from "@/components/SiteHeader";
import { site } from "@/lib/brand";
import { getAppOriginForOg } from "@/lib/coverMedia";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const metadataBase = (() => {
  const origin = getAppOriginForOg();
  if (!origin) return undefined;
  try {
    return new URL(origin);
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  title: site.title,
  description: site.description,
  ...(metadataBase ? { metadataBase } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function shouldShowSiteHeader(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return true;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 1) return isReservedPublicSlug(parts[0] ?? "");
  if (
    parts.length >= 2 &&
    !isReservedPublicSlug(parts[0] ?? "") &&
    ["classes", "events", "services", "packages", "memberships", "member-zone", "me", "checkout", "auth"].includes(parts[1] ?? "")
  ) {
    return false;
  }
  return true;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "/";
  const showSiteHeader = shouldShowSiteHeader(pathname);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {showSiteHeader ? <SiteHeader /> : null}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}

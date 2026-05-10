import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { PwaUpdateBanner } from "@/components/PwaUpdateBanner";
import "react-easy-crop/react-easy-crop.css";
import "react-international-phone/style.css";
import { site } from "@/lib/brand";
import { getAppOriginForOg } from "@/lib/coverMedia";
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
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="flex min-h-full flex-col bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-50"
        style={{ backgroundColor: "#f8fafc", color: "#1c1917" }}
      >
        {children}
        <Toaster richColors position="bottom-right" closeButton />
        <PwaUpdateBanner />
      </body>
    </html>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ui } from "@/lib/ui";

type Props = {
  href: string;
  children: React.ReactNode;
};

/** Top-left back link for studio public list & detail pages (events, classes, services, packages, member zone). */
export function StudioPublicBackNav({ href, children }: Props) {
  return (
    <Link href={href} className={ui.linkMuted}>
      <ArrowLeft size={14} aria-hidden className="shrink-0" />
      {children}
    </Link>
  );
}

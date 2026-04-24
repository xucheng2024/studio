import Image from "next/image";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";

type Props = {
  src: string | null | undefined;
  alt: string;
  /** Set false only for below-the-fold covers. Default true = eager, high priority. */
  priority?: boolean;
  /** Bottom-right share control (native share or copy link). */
  sharePath?: string;
  shareTitle?: string;
  shareText?: string;
};

/**
 * 16:9 hero cover for public class / package share pages.
 * - Uses next/image for automatic WebP/AVIF conversion + responsive srcset.
 * - Priority=true (default) so the hero image is LCP-optimised on mobile.
 * - Falls back to a gradient skeleton when no image is set.
 */
export function ShareCoverImage({
  src,
  alt,
  priority = true,
  sharePath,
  shareTitle,
  shareText,
}: Props) {
  const cornerShare = sharePath ? (
    <div className="absolute bottom-3 right-3 z-20">
      <SessionShareLinkButton sharePath={sharePath} title={shareTitle ?? alt} text={shareText} />
    </div>
  ) : null;

  if (!src?.trim()) {
    return (
      <>
        <div className="relative mb-6 w-full overflow-hidden rounded-2xl bg-linear-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900">
          <div className="aspect-video w-full" aria-hidden="true" />
          {cornerShare}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative mb-6 w-full overflow-hidden rounded-2xl shadow-sm">
        <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900">
          <Image
            src={src}
            alt={alt}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 42rem"
            priority={priority}
          />
        </div>
        {cornerShare}
      </div>
    </>
  );
}

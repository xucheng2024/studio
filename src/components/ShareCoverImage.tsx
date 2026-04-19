type Props = {
  src: string | null | undefined;
  alt: string;
  priority?: boolean;
};

/**
 * 16:9 hero cover for public class / package share pages.
 * - Uses eager loading (priority) so the cover appears immediately on mobile.
 * - Falls back to an animated skeleton when no image is set, keeping layout stable.
 */
export function ShareCoverImage({ src, alt, priority = true }: Props) {
  const hasCover = !!src?.trim();

  if (!hasCover) {
    return (
      <div className="mb-6 w-full overflow-hidden rounded-2xl bg-linear-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900">
        <div className="aspect-video w-full" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mb-6 w-full overflow-hidden rounded-2xl shadow-sm">
      <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src ?? undefined}
          alt={alt}
          className="size-full object-cover"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
        />
      </div>
    </div>
  );
}

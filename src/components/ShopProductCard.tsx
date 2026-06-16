import Image from "next/image";
import Link from "next/link";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { formatPriceOrFree } from "@/lib/priceDisplay";

type Props = {
  href: string;
  title: string;
  imageUrl: string | null;
  price: number;
  summary?: string | null;
  outOfStock?: boolean;
  priority?: boolean;
  sizes?: string;
};

/** Compact marketplace-style product tile (whole card is the link, no CTA button). */
export function ShopProductCard({
  href,
  title,
  imageUrl,
  price,
  summary,
  outOfStock = false,
  priority = false,
  sizes = "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 280px",
}: Props) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-stone-200/80 transition hover:shadow-md active:opacity-95 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <div className="relative aspect-square w-full bg-stone-100 dark:bg-stone-900">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            width={600}
            height={600}
            sizes={sizes}
            priority={priority}
            className="h-full w-full object-cover transition group-hover:opacity-95"
          />
        ) : null}
        {outOfStock ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-stone-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Sold out
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        <p className="line-clamp-2 text-xs leading-snug text-stone-800 dark:text-stone-100">{title}</p>
        <p className="text-sm font-bold tabular-nums text-teal-700 dark:text-teal-400">
          {formatPriceOrFree(STUDIO_CURRENCY, price)}
        </p>
        {summary ? (
          <p className="line-clamp-1 text-[11px] leading-tight text-stone-500 dark:text-stone-400">{summary}</p>
        ) : null}
      </div>
    </Link>
  );
}

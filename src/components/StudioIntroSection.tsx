"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { CalBookingButton } from "@/components/CalBookingButton";
import { PublicVideoCover } from "@/components/PublicVideoCover";

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M6.94 8.5A1.44 1.44 0 1 0 6.94 5.62a1.44 1.44 0 0 0 0 2.88ZM5.7 9.75h2.48V18H5.7V9.75Zm4.04 0h2.38v1.12h.03c.33-.63 1.15-1.3 2.37-1.3 2.53 0 3 1.67 3 3.84V18h-2.48v-4.07c0-.97-.02-2.22-1.35-2.22-1.36 0-1.57 1.06-1.57 2.15V18H9.74V9.75Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M13.2 20v-7.02h2.36l.35-2.74H13.2V8.5c0-.79.22-1.33 1.35-1.33H16V4.72c-.25-.03-1.11-.11-2.12-.11-2.1 0-3.54 1.28-3.54 3.63v2H8v2.74h2.34V20h2.86Z" />
    </svg>
  );
}

function TiktokIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M14.82 4c.4 1.6 1.35 2.85 2.84 3.49a5.2 5.2 0 0 0 2.02.42v2.4a7.58 7.58 0 0 1-3.9-1.08v5.1a5.33 5.33 0 1 1-5.34-5.33c.36 0 .7.03 1.04.1v2.45a2.88 2.88 0 1 0 1.86 2.7V4h1.48Z" />
    </svg>
  );
}

function YoutubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M20.45 7.1a2.5 2.5 0 0 0-1.76-1.77C17.1 5 12 5 12 5s-5.1 0-6.69.33A2.5 2.5 0 0 0 3.55 7.1C3.22 8.69 3.22 12 3.22 12s0 3.31.33 4.9a2.5 2.5 0 0 0 1.76 1.77C6.9 19 12 19 12 19s5.1 0 6.69-.33a2.5 2.5 0 0 0 1.76-1.77c.33-1.59.33-4.9.33-4.9s0-3.31-.33-4.9ZM10.35 14.82V9.18L15.27 12l-4.92 2.82Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M18.9 4H21l-4.59 5.25L21.82 20h-4.24l-3.32-4.78L10.08 20H8l4.9-5.6L3.18 4h4.35l3 4.32L14.3 4h4.6Zm-.75 14.5h1.17L7.2 5.43H5.95L18.15 18.5Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="M4 7.5h16v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
      <path d="m5 8 7 5 7-5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current" strokeWidth="1.8">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

type SocialLink = {
  href: string;
  label: string;
  icon: typeof InstagramIcon;
  iconClassName: string;
};

type Props = {
  studioName: string;
  studioMediaCover: string | null;
  embedUrl: string | null;
  videoUrl: string | null;
  intro: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  xUrl: string | null;
  contactEmail: string | null;
  bookingCalLink?: string | null;
  bookingButtonClassName?: string;
};

function EmailPopoverButton({ contactEmail, emailHref }: { contactEmail: string; emailHref: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function handleCopy() {
    await navigator.clipboard.writeText(contactEmail).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Contact email"
        title={contactEmail}
        className="inline-flex size-5 items-center justify-center text-teal-700 transition hover:opacity-70 dark:text-teal-400"
      >
        <MailIcon />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-56 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl dark:border-stone-700 dark:bg-stone-900">
          <p className="truncate px-3 py-1.5 text-xs text-stone-400 dark:text-stone-500">{contactEmail}</p>
          <a
            href={emailHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <span className="text-teal-700 dark:text-teal-400"><MailIcon /></span>
            Send email
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <span className={copied ? "text-teal-700 dark:text-teal-400" : "text-stone-400"}><CopyIcon /></span>
            {copied ? "Copied!" : "Copy address"}
          </button>
        </div>
      )}
    </div>
  );
}

export function StudioIntroSection({
  studioName,
  studioMediaCover,
  embedUrl,
  videoUrl,
  intro,
  instagramUrl,
  linkedinUrl,
  facebookUrl,
  tiktokUrl,
  youtubeUrl,
  xUrl,
  contactEmail,
  bookingCalLink,
  bookingButtonClassName,
}: Props) {
  const emailHref = useMemo(() => {
    if (!contactEmail) return null;
    const subject = encodeURIComponent(`Inquiry from ${studioName}`);
    const body = encodeURIComponent(`Hi ${studioName},\n\nI found you through your website and would like to learn more about your offerings.\n\n`);
    return `mailto:${contactEmail}?subject=${subject}&body=${body}`;
  }, [contactEmail, studioName]);

  const socialLinks = [
    instagramUrl ? { href: instagramUrl, label: "Instagram", icon: InstagramIcon, iconClassName: "text-pink-600" } : null,
    linkedinUrl ? { href: linkedinUrl, label: "LinkedIn", icon: LinkedInIcon, iconClassName: "text-sky-700" } : null,
    facebookUrl ? { href: facebookUrl, label: "Facebook", icon: FacebookIcon, iconClassName: "text-blue-600" } : null,
    tiktokUrl ? { href: tiktokUrl, label: "TikTok", icon: TiktokIcon, iconClassName: "text-stone-950 dark:text-stone-100" } : null,
    youtubeUrl ? { href: youtubeUrl, label: "YouTube", icon: YoutubeIcon, iconClassName: "text-red-600" } : null,
    xUrl ? { href: xUrl, label: "X", icon: XIcon, iconClassName: "text-stone-950 dark:text-stone-100" } : null,
  ].filter(Boolean) as SocialLink[];

  return (
    <div className="-mx-4 overflow-hidden border-b border-stone-200/70 bg-[linear-gradient(135deg,#f6fbf8_0%,#ffffff_58%,#f8faf9_100%)] px-4 py-6 sm:-mx-6 sm:px-6 sm:py-8 lg:-mx-8 lg:px-8 lg:py-10 dark:border-stone-800 dark:bg-[linear-gradient(135deg,#0f1714_0%,#0c0a09_60%,#111827_100%)]">
      <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-[minmax(260px,48%)_minmax(0,1fr)] sm:items-center lg:grid-cols-[minmax(440px,55%)_minmax(360px,1fr)] lg:gap-9">
        <div className="relative order-2 w-full sm:order-1">
          <div className="rounded-[1.35rem] bg-white/60 p-1 shadow-[0_18px_55px_rgba(15,23,42,0.12)] ring-1 ring-white/80 dark:bg-stone-950/40 dark:shadow-black/30 dark:ring-white/10">
            <PublicVideoCover
              title={studioName}
              coverUrl={studioMediaCover}
              embedUrl={embedUrl}
              fallbackUrl={videoUrl}
              priority
            />
          </div>
        </div>
        <div className="order-1 sm:order-2 sm:pt-1 lg:max-w-lg">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50 sm:text-3xl lg:text-4xl">
            {studioName}
          </h1>
          {intro?.trim() ? (
            <>
              <details className="group mt-3 lg:mt-4">
                <summary className="cursor-pointer list-none text-sm leading-snug text-stone-700 dark:text-stone-300 lg:text-base lg:leading-relaxed">
                  <span className="line-clamp-3 whitespace-pre-wrap group-open:hidden lg:line-clamp-5">
                    {intro.trim()}{" "}
                    <span className="font-semibold text-teal-700 dark:text-teal-400">Read more</span>
                  </span>
                  <span className="hidden text-sm font-semibold text-teal-700 group-open:inline dark:text-teal-400">
                    Show less
                  </span>
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-snug text-stone-700 dark:text-stone-300 lg:text-base lg:leading-relaxed">
                  {intro.trim()}
                </p>
              </details>
              {(socialLinks.length > 0 || (contactEmail && emailHref)) && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {socialLinks.map(({ href, label, icon: Icon, iconClassName }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      title={label}
                      className={`inline-flex size-5 shrink-0 items-center justify-center transition hover:opacity-70 ${iconClassName}`}
                    >
                      <Icon />
                    </a>
                  ))}
                  {contactEmail && emailHref ? (
                    <EmailPopoverButton contactEmail={contactEmail} emailHref={emailHref} />
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-3 text-sm leading-snug text-stone-700 dark:text-stone-300 lg:text-base lg:leading-relaxed">
                Welcome to our studio. Explore services and get in touch.
              </p>
              {socialLinks.length > 0 || (contactEmail && emailHref) ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {socialLinks.map(({ href, label, icon: Icon, iconClassName }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      title={label}
                      className={`inline-flex size-5 shrink-0 items-center justify-center transition hover:opacity-70 ${iconClassName}`}
                    >
                      <Icon />
                    </a>
                  ))}
                  {contactEmail && emailHref ? (
                    <EmailPopoverButton contactEmail={contactEmail} emailHref={emailHref} />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          {bookingCalLink ? (
            <div className="mt-5 hidden w-full sm:flex sm:mt-6">
              <CalBookingButton calLink={bookingCalLink} className={bookingButtonClassName} />
            </div>
          ) : null}
        </div>
        {bookingCalLink ? (
          <div className="order-3 flex w-full sm:hidden">
            <CalBookingButton calLink={bookingCalLink} className={bookingButtonClassName} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

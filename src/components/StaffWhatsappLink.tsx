/** Opens the staff WhatsApp app with a prefilled message. Does not send via API. */
export function StaffWhatsappLink({ href, label = "WhatsApp" }: { href: string | null; label?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Message on WhatsApp"
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/35 bg-[#25D366]/10 px-3 py-1.5 text-sm font-medium text-[#128C7E] transition hover:bg-[#25D366]/18 active:scale-[0.98] dark:border-[#25D366]/25 dark:text-[#25D366]"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
        <path d="M19.11 17.24c-.27-.14-1.61-.8-1.86-.89-.25-.09-.43-.14-.61.14-.18.27-.7.89-.86 1.07-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.41.12-.54.12-.12.27-.32.41-.48.14-.16.18-.27.27-.46.09-.18.05-.34-.02-.48-.07-.14-.61-1.48-.84-2.03-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.48.07-.73.34-.25.27-.95.93-.95 2.27s.98 2.64 1.11 2.82c.14.18 1.92 2.93 4.66 4.11.65.28 1.15.45 1.55.58.65.21 1.24.18 1.71.11.52-.08 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.11-.25-.18-.52-.32z" />
        <path d="M16.01 3.2c-7.06 0-12.78 5.72-12.78 12.78 0 2.25.59 4.45 1.71 6.39L3.2 28.8l6.58-1.72a12.74 12.74 0 0 0 6.23 1.59h.01c7.06 0 12.78 5.72 12.78 12.78S23.07 3.2 16.01 3.2zm0 23.36h-.01c-1.92 0-3.8-.52-5.45-1.49l-.39-.23-3.91 1.02 1.04-3.81-.25-.39a10.58 10.58 0 0 1-1.63-5.67c0-5.85 4.76-10.61 10.61-10.61 2.83 0 5.49 1.1 7.49 3.11a10.53 10.53 0 0 1 3.11 7.49c0 5.85-4.76 10.61-10.61 10.61z" />
      </svg>
      {label}
    </a>
  );
}

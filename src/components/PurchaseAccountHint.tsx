import { ui } from "@/lib/ui";

export function PurchaseAccountHint({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-950/40 ${className}`.trim()}>
      <p className="text-sm font-medium text-stone-900 dark:text-stone-100">Account and guest checkout</p>
      <p className={`mt-1 text-xs ${ui.muted}`}>
        If you&apos;re signed in, this purchase attaches to your account automatically. If you continue as a guest,
        sign in later with the same email to see your orders, bookings, passes, or access.
      </p>
    </div>
  );
}

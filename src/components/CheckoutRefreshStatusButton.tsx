"use client";

import { useRouter } from "next/navigation";
import { ui } from "@/lib/ui";

/** Manual refresh after completing payment in another tab (e.g. HitPay). */
export function CheckoutRefreshStatusButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={`${ui.btnSecondary} mt-3 w-full justify-center text-sm`}
      onClick={() => router.refresh()}
    >
      I finished paying on HitPay — refresh now
    </button>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { autoApplyRecommendedBookingSetupAction } from "@/app/(app)/dashboard/actions";

/** Applies the recommended booking setup once, the first time the studio is ready for it. */
export function AutoRecommendedSetup({ studioId }: { studioId: string }) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void autoApplyRecommendedBookingSetupAction(studioId)
      .then(({ changes }) => {
        if (!changes.length) return;
        toast.success(`Recommended setup applied: ${changes.join(". ")}. You can adjust anything in the tabs above.`);
        router.refresh();
      })
      .catch(() => {});
  }, [router, studioId]);

  return null;
}

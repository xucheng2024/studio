import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { normalizeStudioSlug } from "@/lib/slug";

export default async function BookingPage() {
  const c = await cookies();
  const activeSlug = normalizeStudioSlug(c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
  if (activeSlug) {
    redirect(`/booking/${activeSlug}`);
  }
  redirect("/");
}

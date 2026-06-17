import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { normalizeStudioSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export type MePageScope = {
  studioSlug?: string | null;
};

export async function requireMeUser(scope?: MePageScope, pagePath?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const studioSlug = normalizeStudioSlug(scope?.studioSlug ?? "");
  if (!user) {
    if (studioSlug && pagePath) {
      redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/${pagePath}`)}`);
    }
    redirect("/login");
  }
  return { supabase, user, studioSlug };
}

export async function requireStudioScope(studioSlugRaw: string | null | undefined) {
  const studioSlug = normalizeStudioSlug(studioSlugRaw ?? "");
  if (!studioSlug) redirect("/");
  const supabase = await createClient();
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio?.id) redirect("/");
  return { supabase, studioSlug, studio };
}

export async function getActiveMemberStudioSlugFromCookie() {
  const cookieStore = await cookies();
  return normalizeStudioSlug(cookieStore.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
}

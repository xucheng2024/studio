import { redirect } from "next/navigation";
import { CompleteProfileForm } from "@/components/CompleteProfileForm";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function CompleteProfilePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  const nextPath = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  if (profile?.phone?.trim()) {
    redirect(nextPath);
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <h1 className={ui.h1}>Complete your profile</h1>
        <p className={`mt-1 ${ui.muted}`}>Please add your phone number before continuing.</p>
        <CompleteProfileForm
          initialName={profile?.full_name ?? ""}
          initialPhone={profile?.phone ?? ""}
          nextPath={nextPath}
          email={user.email ?? ""}
        />
      </div>
    </main>
  );
}

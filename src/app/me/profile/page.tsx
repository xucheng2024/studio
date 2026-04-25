import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function MyProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, phone, notes")
    .eq("id", user.id)
    .maybeSingle();

  async function updateProfile(formData: FormData) {
    "use server";
    const serverSupabase = await createClient();
    const {
      data: { user: currentUser },
    } = await serverSupabase.auth.getUser();
    if (!currentUser) redirect("/login");

    const full_name = String(formData.get("full_name") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;

    await serverSupabase
      .from("user_profiles")
      .upsert(
        {
          id: currentUser.id,
          email: currentUser.email ?? null,
          full_name,
          phone,
          notes,
        },
        { onConflict: "id" },
      );

    revalidatePath("/me/profile");
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <h1 className={ui.h1}>My profile</h1>
        <p className={`mt-1 ${ui.muted}`}>Update your contact information used by the studio.</p>

        <form action={updateProfile} className={`${ui.card} mt-6 grid gap-4`}>
          <label className="grid gap-1.5">
            <span className={ui.label}>Email</span>
            <input type="email" className={`${ui.input} opacity-70`} value={user.email ?? ""} disabled readOnly />
          </label>
          <label className="grid gap-1.5">
            <span className={ui.label}>Full name</span>
            <input
              name="full_name"
              className={ui.input}
              placeholder="Alex Kim"
              defaultValue={profile?.full_name ?? ""}
              autoComplete="name"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={ui.label}>Phone</span>
            <input
              name="phone"
              className={ui.input}
              placeholder="+65 9123 4567"
              defaultValue={profile?.phone ?? ""}
              autoComplete="tel"
            />
          </label>
          <label className="grid gap-1.5">
            <span className={ui.label}>Notes</span>
            <textarea
              name="notes"
              className={ui.input}
              placeholder="Allergies, injuries, communication preference (optional)"
              defaultValue={profile?.notes ?? ""}
              rows={4}
            />
          </label>
          <div>
            <button type="submit" className={ui.btnPrimary}>
              Save profile
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}


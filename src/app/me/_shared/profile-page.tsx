import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormPhoneField } from "@/components/ui/FormPhoneField";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { requireMeUser, type MePageScope } from "./context";

export async function renderProfilePage(scope?: MePageScope) {
  const studioSlug = scope?.studioSlug ?? null;
  const { supabase, user } = await requireMeUser(scope, "profile");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, phone, notes, shipping_name, shipping_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_postal_code, shipping_country")
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
    const shipping_name = String(formData.get("shipping_name") ?? "").trim() || null;
    const shipping_phone = String(formData.get("shipping_phone") ?? "").trim() || null;
    const shipping_address_line1 = String(formData.get("shipping_address_line1") ?? "").trim() || null;
    const shipping_address_line2 = String(formData.get("shipping_address_line2") ?? "").trim() || null;
    const shipping_city = String(formData.get("shipping_city") ?? "").trim() || null;
    const shipping_postal_code = String(formData.get("shipping_postal_code") ?? "").trim() || null;
    const shipping_country = String(formData.get("shipping_country") ?? "SG").trim() || "SG";

    await serverSupabase
      .from("user_profiles")
      .upsert(
        {
          id: currentUser.id,
          email: currentUser.email ?? null,
          full_name,
          phone,
          notes,
          shipping_name,
          shipping_phone,
          shipping_address_line1,
          shipping_address_line2,
          shipping_city,
          shipping_postal_code,
          shipping_country,
        },
        { onConflict: "id" },
      );

    revalidatePath(studioSlug ? `/${studioSlug}/me/profile` : "/me/profile");
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
            <FormPhoneField name="phone" defaultValue={profile?.phone ?? ""} />
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
          <div className="mt-2 border-t border-stone-200 pt-4 dark:border-stone-700">
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Shipping address</p>
            <p className={`mt-1 text-xs ${ui.muted}`}>Used when you buy items from the shop.</p>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5">
                <span className={ui.label}>Recipient name</span>
                <input name="shipping_name" className={ui.input} defaultValue={profile?.shipping_name ?? ""} autoComplete="name" />
              </label>
              <label className="grid gap-1.5">
                <span className={ui.label}>Shipping phone</span>
                <FormPhoneField name="shipping_phone" defaultValue={profile?.shipping_phone ?? ""} />
              </label>
              <label className="grid gap-1.5">
                <span className={ui.label}>Address line 1</span>
                <input name="shipping_address_line1" className={ui.input} defaultValue={profile?.shipping_address_line1 ?? ""} autoComplete="address-line1" />
              </label>
              <label className="grid gap-1.5">
                <span className={ui.label}>Address line 2</span>
                <input name="shipping_address_line2" className={ui.input} defaultValue={profile?.shipping_address_line2 ?? ""} autoComplete="address-line2" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={ui.label}>City</span>
                  <input name="shipping_city" className={ui.input} defaultValue={profile?.shipping_city ?? ""} autoComplete="address-level2" />
                </label>
                <label className="grid gap-1.5">
                  <span className={ui.label}>Postal code</span>
                  <input name="shipping_postal_code" className={ui.input} defaultValue={profile?.shipping_postal_code ?? ""} autoComplete="postal-code" />
                </label>
              </div>
              <label className="grid gap-1.5">
                <span className={ui.label}>Country</span>
                <input name="shipping_country" className={ui.input} defaultValue={profile?.shipping_country ?? "SG"} autoComplete="country" />
              </label>
            </div>
          </div>
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

import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Create a studio from the overview first.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have clients access.</p>;
  }

  let classQuery = supabase
    .from("classes")
    .select("id, location_id")
    .in("studio_id", studioIds);
  if (selectedLocationId) classQuery = classQuery.eq("location_id", selectedLocationId);
  const { data: classRows } = await classQuery;
  const classIds = (classRows ?? []).map((c) => c.id);

  let sessionIds: string[] = [];
  if (classIds.length) {
    const { data: sess } = await supabase
      .from("class_sessions")
      .select("id")
      .in("class_id", classIds);
    sessionIds = (sess ?? []).map((s) => s.id);
  }

  const { data: bookings } =
    sessionIds.length > 0
      ? await supabase
          .from("bookings")
          .select(
            `
          id,
          client_id,
          status,
          created_at,
          guest_name,
          guest_email,
          users ( email ),
          class_sessions ( start_time, classes ( title ) )
        `,
          )
          .in("session_id", sessionIds)
          .order("created_at", { ascending: false })
      : { data: [] as const };

  const packsQuery = supabase
    .from("client_packages")
    .select(
      `
      id,
      client_id,
      credits_left,
      expiry_date,
      packages!inner ( name, studio_id )
    `,
    )
    .in("packages.studio_id", studioIds);
  const { data: packs } = await packsQuery;

  return (
    <div className="flex flex-col gap-8">
      <h1 className={ui.h1}>Clients</h1>

      <div>
        <h2 className={ui.h2}>Credits in your studio</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(packs ?? []).map((p) => {
            const pkg = p.packages as { name?: string } | null;
            const u = p.client_id;
            return (
              <li key={p.id}>
                <span className={`font-mono text-xs ${ui.muted}`}>{u}</span> · {pkg?.name} ·{" "}
                {p.credits_left} left
                {p.expiry_date
                  ? ` · exp ${new Date(p.expiry_date).toLocaleDateString()}`
                  : ""}
              </li>
            );
          })}
        </ul>
        {!packs?.length ? (
          <p className={`text-sm ${ui.muted}`}>No package balances yet.</p>
        ) : null}
      </div>

      <div>
        <h2 className={ui.h2}>Attendance history</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(bookings ?? []).map((b) => {
            const u = b.users as { email?: string | null } | null;
            const cs = b.class_sessions as {
              start_time?: string;
              classes?: { title?: string } | null;
            } | null;
            const label =
              b.client_id != null
                ? (u?.email ?? b.client_id)
                : `${b.guest_name ?? "Guest"} (${b.guest_email ?? ""})`;
            return (
              <li
                key={b.id}
                className="rounded-lg border border-stone-100 px-3 py-2 dark:border-stone-800"
              >
                <span className="text-stone-800 dark:text-stone-200">{label}</span> · {b.status} ·{" "}
                {cs?.classes?.title ?? "Class"} ·{" "}
                {cs?.start_time ? new Date(cs.start_time).toLocaleString() : ""}
              </li>
            );
          })}
        </ul>
        {!bookings?.length ? (
          <p className={`text-sm ${ui.muted}`}>No bookings yet.</p>
        ) : null}
      </div>
    </div>
  );
}

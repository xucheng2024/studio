import { redirect } from "next/navigation";
import {
  disableOwnerAndSuspendStudios,
  grantOwnerAccessByEmail,
  resumeStudio,
  setOwnerGrantStatus,
  suspendStudio,
} from "./actions";
import { ConfirmForm } from "@/components/ConfirmForm";
import { SubmitButton } from "@/components/SubmitButton";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    q?: string;
    grant?: string;
    studio_contract?: string;
    owners_success?: string;
    owners_error?: string;
    owner_error?: string;
    owner_success?: string;
    owner_grant_updated?: string;
  }>;
};

type StudioRow = {
  id: string;
  name: string;
  public_slug: string;
  contract_status: string;
  contract_ends_at: string | null;
  owner_id: string;
};

type OwnerAggRow = {
  userId: string;
  email: string;
  grantActive: boolean;
  studioCount: number;
  activeStudioCount: number;
  suspendedStudioCount: number;
  studios: StudioRow[];
};

function formatDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildOwnerRows(
  studios: StudioRow[],
  grants: { user_id: string; is_active: boolean }[],
  emails: Map<string, string | null>,
): OwnerAggRow[] {
  const grantByUser = new Map<string, boolean>();
  for (const g of grants) grantByUser.set(g.user_id, g.is_active);

  const ownerIds = new Set<string>();
  for (const g of grants) ownerIds.add(g.user_id);
  for (const s of studios) ownerIds.add(s.owner_id);

  const rows: OwnerAggRow[] = [];
  for (const id of ownerIds) {
    const sts = studios.filter((s) => s.owner_id === id);
    const activeStudioCount = sts.filter((s) => s.contract_status === "active").length;
    const suspendedStudioCount = sts.filter((s) => s.contract_status === "suspended").length;
    rows.push({
      userId: id,
      email: emails.get(id) ?? id,
      grantActive: grantByUser.get(id) ?? false,
      studioCount: sts.length,
      activeStudioCount,
      suspendedStudioCount,
      studios: sts,
    });
  }
  rows.sort((a, b) => a.email.localeCompare(b.email));
  return rows;
}

export default async function OwnerAccessAdminPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!isSuperAdminEmail(user.email)) {
    redirect("/dashboard/overview");
  }

  const q = (sp.q ?? "").trim().toLowerCase();
  const grantFilter = sp.grant ?? "all";
  const studioContractFilter = sp.studio_contract ?? "all";

  const admin = createAdminClient();
  const { data: studioRows } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, contract_ends_at, owner_id");

  const studios = (studioRows ?? []) as StudioRow[];

  const { data: grants } = await admin.from("platform_owner_grants").select("user_id, is_active, created_at");

  const ownerIds = new Set<string>();
  for (const g of grants ?? []) ownerIds.add(g.user_id);
  for (const s of studios) ownerIds.add(s.owner_id);

  const ids = [...ownerIds];
  const emails = new Map<string, string | null>();
  if (ids.length) {
    const { data: users } = await admin.from("users").select("id, email").in("id", ids);
    for (const u of users ?? []) emails.set(u.id, u.email ?? null);
  }

  let owners = buildOwnerRows(studios, (grants ?? []) as { user_id: string; is_active: boolean }[], emails);

  if (q) {
    owners = owners.filter((o) => (o.email ?? "").toLowerCase().includes(q));
  }
  if (grantFilter === "active") {
    owners = owners.filter((o) => o.grantActive);
  } else if (grantFilter === "inactive") {
    owners = owners.filter((o) => !o.grantActive);
  }

  const { data: auditRows } = await admin
    .from("operation_audits")
    .select("id, action, target_type, target_id, actor_id, before_state, after_state, created_at")
    .in("action", [
      "owner_grant_enabled",
      "owner_grant_disabled",
      "owner_disabled_and_studios_suspended",
      "studio_suspended",
      "studio_resumed",
    ])
    .order("created_at", { ascending: false })
    .limit(50);

  const successMsg =
    sp.owners_success === "grant_email" || sp.owner_success === "granted"
      ? "Owner workspace access granted."
      : sp.owners_success === "grant_on" || sp.owner_grant_updated === "1"
        ? "Owner grant enabled."
        : sp.owners_success === "grant_off"
          ? "Owner grant disabled (studios unchanged)."
          : sp.owners_success === "disable_owner_suspend_all"
            ? "Owner grant disabled and all studios under this owner are now suspended."
            : sp.owners_success === "studio_suspended"
              ? "Studio suspended."
              : sp.owners_success === "studio_resumed"
                ? "Studio resumed (contract active)."
                : null;

  const errKey = sp.owners_error ?? sp.owner_error;
  const errorMsg =
    errKey === "forbidden"
      ? "You do not have access to this action."
      : errKey === "invalid_email"
        ? "Please enter a valid email."
        : errKey === "email_not_registered"
          ? "Email has no account yet. Ask the user to sign in once first."
          : errKey === "save_failed"
            ? "Could not save changes."
            : errKey === "invalid_user"
              ? "Invalid user reference."
              : errKey === "invalid_studio" || errKey === "unknown_studio"
                ? "Studio not found."
                : errKey === "invalid_date"
                  ? "Invalid contract end date."
                  : errKey === "unknown_owner"
                    ? "Owner not found."
                    : errKey === "rpc_failed"
                      ? "Bulk operation failed. Apply migration 021 or verify the RPC in Supabase."
                      : errKey
                        ? `Error (${errKey}).`
                        : null;

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Platform owner access</h1>
        <p className={ui.muted}>
          Super admin only. Grant owner workspace access, review owners and venues, suspend contracts, or disable grants. Dangerous actions require confirmation.
        </p>
      </div>

      {successMsg ? <p className={ui.success}>{successMsg}</p> : null}
      {errorMsg ? <p className={ui.error}>{errorMsg}</p> : null}

      <form method="get" className={`${ui.card} flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end`}>
        <label className="flex w-full min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[200px]">
          <span className={ui.label}>Search owner email</span>
          <input name="q" type="search" className={ui.input} placeholder="contains…" defaultValue={sp.q ?? ""} />
        </label>
        <label className="flex w-full min-w-0 flex-col gap-1.5 sm:min-w-[160px]">
          <span className={ui.label}>Grant status</span>
          <select name="grant" className={ui.select} defaultValue={grantFilter}>
            <option value="all">All</option>
            <option value="active">Grant active</option>
            <option value="inactive">Grant inactive</option>
          </select>
        </label>
        <label className="flex w-full min-w-0 flex-col gap-1.5 sm:min-w-[180px]">
          <span className={ui.label}>Studios in list</span>
          <select name="studio_contract" className={ui.select} defaultValue={studioContractFilter}>
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="suspended">Suspended only</option>
          </select>
        </label>
        <button type="submit" className={`${ui.btnSecondary} w-full md:w-auto`}>
          Apply filters
        </button>
      </form>

      <form action={grantOwnerAccessByEmail} className={`${ui.card} flex flex-col gap-3`}>
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Grant platform owner access</h2>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Owner email</span>
          <input name="email" type="email" required className={ui.input} placeholder="owner@studio.com" />
        </label>
        <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Granting…">
          Grant owner workspace access
        </SubmitButton>
        <p className={`text-xs ${ui.muted}`}>
          The account must exist (user has signed in at least once). Granting only flips the platform gate — it does not create studios.
        </p>
      </form>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Owners &amp; studios</h2>
        {owners.length === 0 ? (
          <p className={ui.muted}>No owners match the current filters.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {owners.map((o) => {
              const visibleStudios =
                studioContractFilter === "active"
                  ? o.studios.filter((s) => s.contract_status === "active")
                  : studioContractFilter === "suspended"
                    ? o.studios.filter((s) => s.contract_status === "suspended")
                    : o.studios;
              return (
                <div key={o.userId} className={ui.card}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-mono text-xs text-stone-500 dark:text-stone-400">{o.userId}</p>
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{o.email}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span
                          className={
                            o.grantActive
                              ? "rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                              : "rounded-md bg-stone-200 px-2 py-0.5 font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                          }
                        >
                          Grant: {o.grantActive ? "active" : "inactive"}
                        </span>
                        <span className="rounded-md border border-stone-200 px-2 py-0.5 text-stone-600 dark:border-stone-700 dark:text-stone-400">
                          Studios {o.studioCount} (active {o.activeStudioCount} · suspended {o.suspendedStudioCount})
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <ConfirmForm
                        action={setOwnerGrantStatus}
                        confirmMessage={
                          o.grantActive
                            ? "Disable platform owner access for this user? Existing studios and contract state stay as they are; the user will not be able to create new studios until re-enabled."
                            : "Enable platform owner access for this user so they can create new studios (subject to other checks)?"
                        }
                        className="inline"
                      >
                        <input type="hidden" name="user_id" value={o.userId} />
                        <input type="hidden" name="is_active" value={o.grantActive ? "false" : "true"} />
                        <SubmitButton
                          className={o.grantActive ? `${ui.btnSecondarySm}` : `${ui.btnPrimary} px-3 py-1.5 text-xs`}
                          pendingText="Saving…"
                        >
                          {o.grantActive ? "Disable grant" : "Enable grant"}
                        </SubmitButton>
                      </ConfirmForm>
                      <ConfirmForm
                        action={disableOwnerAndSuspendStudios}
                        confirmMessage={
                          "Disable owner grant AND set EVERY studio under this owner to suspended? Owner and staff lose back-office access for those venues until you resume contracts. Continue?"
                        }
                        className="inline"
                      >
                        <input type="hidden" name="owner_user_id" value={o.userId} />
                        <SubmitButton className={`${ui.btnSecondarySm} border-amber-300 text-amber-950 dark:border-amber-800 dark:text-amber-100`} pendingText="Working…">
                          Disable grant + suspend all studios
                        </SubmitButton>
                      </ConfirmForm>
                    </div>
                  </div>

                  <details className="mt-4 rounded-xl border border-stone-200/80 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/40">
                    <summary className="cursor-pointer text-sm font-medium text-stone-800 dark:text-stone-200">
                      Studios ({visibleStudios.length} shown)
                    </summary>
                    {visibleStudios.length === 0 ? (
                      <p className={`mt-2 text-sm ${ui.muted}`}>No studios match the studio contract filter.</p>
                    ) : (
                      <>
                        <div className="mt-3 hidden overflow-x-auto md:block">
                        <table className="min-w-[720px] w-full text-sm">
                          <thead>
                            <tr className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800">
                              <th className="pb-2 pr-3 font-medium">Studio</th>
                              <th className="pb-2 pr-3 font-medium">Slug</th>
                              <th className="pb-2 pr-3 font-medium">Contract</th>
                              <th className="pb-2 pr-3 font-medium">Ends</th>
                              <th className="pb-2 font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleStudios.map((s) => (
                              <tr key={s.id} className="border-t border-stone-200/80 dark:border-stone-800/80">
                                <td className="py-2.5 pr-3 align-top">
                                  <div className="font-medium text-stone-900 dark:text-stone-100">{s.name}</div>
                                  <div className="font-mono text-[11px] text-stone-500">{s.id}</div>
                                </td>
                                <td className="py-2.5 pr-3 align-top font-mono text-xs">{s.public_slug}</td>
                                <td className="py-2.5 pr-3 align-top">
                                  <span
                                    className={
                                      s.contract_status === "active"
                                        ? "rounded-md bg-teal-100/80 px-2 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-100"
                                        : "rounded-md bg-amber-100/80 px-2 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                                    }
                                  >
                                    {s.contract_status}
                                  </span>
                                </td>
                                <td className="py-2.5 pr-3 align-top text-xs text-stone-600 dark:text-stone-400">
                                  {s.contract_ends_at
                                    ? new Date(s.contract_ends_at).toLocaleString(undefined, {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      })
                                    : "—"}
                                </td>
                                <td className="py-2.5 align-top">
                                  <div className="flex flex-col items-start gap-2">
                                    {s.contract_status === "active" ? (
                                      <ConfirmForm
                                        action={suspendStudio}
                                        confirmMessage="Suspend this studio? Staff and owner lose back-office access for this venue until resumed."
                                        className="inline"
                                      >
                                        <input type="hidden" name="studio_id" value={s.id} />
                                        <SubmitButton className={ui.btnSecondarySm} pendingText="Suspending…">
                                          Suspend
                                        </SubmitButton>
                                      </ConfirmForm>
                                    ) : (
                                      <ConfirmForm
                                        action={resumeStudio}
                                        confirmMessage="Resume this studio (contract active)? Back-office access returns if other checks pass."
                                        className="flex flex-col items-start gap-2"
                                      >
                                        <input type="hidden" name="studio_id" value={s.id} />
                                        <label className="flex w-full min-w-48 flex-col gap-1">
                                          <span className={`text-xs ${ui.muted}`}>Set contract ends (optional)</span>
                                          <input
                                            type="datetime-local"
                                            name="contract_ends_at"
                                            className={ui.input}
                                            defaultValue={formatDatetimeLocal(s.contract_ends_at)}
                                          />
                                        </label>
                                        <SubmitButton className={ui.btnPrimarySm} pendingText="Resuming…">
                                          Resume
                                        </SubmitButton>
                                      </ConfirmForm>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                        <ul className="mt-3 grid gap-2 md:hidden">
                        {visibleStudios.map((s) => (
                          <li
                            key={`${s.id}-mobile`}
                            className="rounded-xl border border-stone-200/80 bg-white/80 p-3 dark:border-stone-800 dark:bg-stone-950/50"
                          >
                            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{s.name}</p>
                            <p className="mt-0.5 break-all font-mono text-[11px] text-stone-500">{s.id}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className={ui.badgeNeutral}>Slug: {s.public_slug}</span>
                              <span
                                className={
                                  s.contract_status === "active"
                                    ? "rounded-md bg-teal-100/80 px-2 py-0.5 font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-100"
                                    : "rounded-md bg-amber-100/80 px-2 py-0.5 font-medium text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                                }
                              >
                                {s.contract_status}
                              </span>
                            </div>
                            <p className={`mt-2 text-xs ${ui.muted}`}>
                              Ends:{" "}
                              {s.contract_ends_at
                                ? new Date(s.contract_ends_at).toLocaleString(undefined, {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })
                                : "—"}
                            </p>
                            <div className="mt-3">
                              {s.contract_status === "active" ? (
                                <ConfirmForm
                                  action={suspendStudio}
                                  confirmMessage="Suspend this studio? Staff and owner lose back-office access for this venue until resumed."
                                  className="inline"
                                >
                                  <input type="hidden" name="studio_id" value={s.id} />
                                  <SubmitButton className={ui.btnSecondarySm} pendingText="Suspending…">
                                    Suspend
                                  </SubmitButton>
                                </ConfirmForm>
                              ) : (
                                <ConfirmForm
                                  action={resumeStudio}
                                  confirmMessage="Resume this studio (contract active)? Back-office access returns if other checks pass."
                                  className="flex flex-col items-start gap-2"
                                >
                                  <input type="hidden" name="studio_id" value={s.id} />
                                  <label className="flex w-full min-w-0 flex-col gap-1">
                                    <span className={`text-xs ${ui.muted}`}>Set contract ends (optional)</span>
                                    <input
                                      type="datetime-local"
                                      name="contract_ends_at"
                                      className={ui.input}
                                      defaultValue={formatDatetimeLocal(s.contract_ends_at)}
                                    />
                                  </label>
                                  <SubmitButton className={ui.btnPrimarySm} pendingText="Resuming…">
                                    Resume
                                  </SubmitButton>
                                </ConfirmForm>
                              )}
                            </div>
                          </li>
                        ))}
                        </ul>
                      </>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Lifecycle audit (recent)</h2>
        <p className={`text-xs ${ui.muted}`}>Last 50 owner grant and contract actions (superadmin only).</p>
        {(auditRows ?? []).length === 0 ? (
          <p className={ui.muted}>No audit rows yet for these actions.</p>
        ) : (
          <>
            <div className={`${ui.card} hidden overflow-x-auto md:block`}>
            <table className="min-w-[880px] w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800">
                  <th className="pb-2 pr-3 font-medium">Time</th>
                  <th className="pb-2 pr-3 font-medium">Action</th>
                  <th className="pb-2 pr-3 font-medium">Target</th>
                  <th className="pb-2 pr-3 font-medium">Actor</th>
                  <th className="pb-2 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {(auditRows as { id: string; action: string; target_type: string; target_id: string | null; actor_id: string | null; before_state: unknown; after_state: unknown; created_at: string }[]).map(
                  (a) => (
                    <tr key={a.id} className="border-t border-stone-200/80 dark:border-stone-800/80 align-top">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-stone-600 dark:text-stone-400">
                        {new Date(a.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{a.action}</td>
                      <td className="py-2.5 pr-3">
                        <span className="text-xs text-stone-600 dark:text-stone-400">{a.target_type}</span>
                        <div className="font-mono text-[11px] break-all text-stone-500">{a.target_id ?? "—"}</div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-stone-500">{a.actor_id ?? "—"}</td>
                      <td className="py-2.5 max-w-md">
                        <details>
                          <summary className="cursor-pointer text-xs text-teal-700 dark:text-teal-400">before / after</summary>
                          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-stone-100 p-2 text-[10px] text-stone-800 dark:bg-stone-900 dark:text-stone-200">
                            {JSON.stringify({ before: a.before_state, after: a.after_state }, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            </div>
            <ul className="grid gap-2 md:hidden">
            {(auditRows as { id: string; action: string; target_type: string; target_id: string | null; actor_id: string | null; before_state: unknown; after_state: unknown; created_at: string }[]).map(
              (a) => (
                <li key={`${a.id}-mobile`} className="rounded-xl border border-stone-200/80 bg-white/80 p-3 dark:border-stone-800 dark:bg-stone-950/50">
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {new Date(a.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="mt-1 font-mono text-xs text-stone-800 dark:text-stone-200">{a.action}</p>
                  <p className={`mt-1 text-xs ${ui.muted}`}>
                    {a.target_type} · {a.target_id ?? "—"}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-teal-700 dark:text-teal-400">before / after</summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-stone-100 p-2 text-[10px] text-stone-800 dark:bg-stone-900 dark:text-stone-200">
                      {JSON.stringify({ before: a.before_state, after: a.after_state }, null, 2)}
                    </pre>
                  </details>
                </li>
              ),
            )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

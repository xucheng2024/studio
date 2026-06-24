import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { RBAC_CACHE_TAG } from "@/lib/revalidatePublic";
import { isSuperAdminEmail } from "@/lib/super-admin";

export type StaffRole = "owner" | "manager" | "frontdesk" | "instructor" | "client";

export type LocationScope = {
  id: string;
  studio_id: string;
  name: string;
};

export type AccessContext = {
  userId: string;
  isSuperAdmin: boolean;
  roles: Set<StaffRole>;
  memberships: { studio_id: string; location_id: string | null; role: StaffRole }[];
  locations: LocationScope[];
  selectedLocationId: string | null;
  hasSuspendedBackofficeAccess: boolean;
};

type SerializableAccessContext = Omit<AccessContext, "roles"> & {
  roles: StaffRole[];
};

function isBackofficeRole(role: StaffRole) {
  return role === "owner" || role === "manager" || role === "frontdesk" || role === "instructor";
}

function rankRole(role: StaffRole) {
  switch (role) {
    case "owner":
      return 5;
    case "manager":
      return 4;
    case "frontdesk":
      return 3;
    case "instructor":
      return 2;
    default:
      return 1;
  }
}

export function bestRole(ctx: AccessContext): StaffRole {
  let best: StaffRole = "client";
  for (const role of ctx.roles) {
    if (rankRole(role) > rankRole(best)) best = role;
  }
  return best;
}

export function hasStudioRole(
  ctx: AccessContext,
  studioId: string,
  roles: StaffRole[],
) {
  if (ctx.isSuperAdmin) return true;
  return ctx.memberships.some(
    (membership) => membership.studio_id === studioId && roles.includes(membership.role),
  );
}

export function filterStudioIdsByRoles(
  ctx: AccessContext,
  studioIds: string[],
  roles: StaffRole[],
) {
  if (ctx.isSuperAdmin) return [...new Set(studioIds)];
  return [...new Set(studioIds.filter((studioId) => hasStudioRole(ctx, studioId, roles)))];
}

export function canManageSchedule(ctx: AccessContext) {
  const r = bestRole(ctx);
  return r === "owner" || r === "manager" || r === "frontdesk";
}

export function canViewReports(ctx: AccessContext) {
  const r = bestRole(ctx);
  return r === "owner" || r === "manager";
}

export function canCollectPayment(ctx: AccessContext) {
  const r = bestRole(ctx);
  return r === "owner" || r === "manager" || r === "frontdesk";
}

export function canManageStaff(ctx: AccessContext) {
  return bestRole(ctx) === "owner";
}

export function canCheckIn(ctx: AccessContext) {
  const r = bestRole(ctx);
  return r === "owner" || r === "manager" || r === "frontdesk" || r === "instructor";
}

/**
 * Expensive RBAC context builder, memoised per RSC request via React.cache.
 * Accepts primitive args so cache keys compare by value (not object reference).
 *
 * Perf: Phase-1 queries (memberships, owned studios, owner grants, email) run
 * in parallel. Phase-2 (contract-status batch) runs once Phase-1 resolves.
 * Phase-3 (locations) runs after active studio ids are known.
 */
const buildAccessContextCore = async (
  userId: string,
  email: string | null,
  selectedLocationId: string | null,
): Promise<SerializableAccessContext> => {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for RBAC");
  const admin = createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Phase 1: all independent queries in parallel ──────────────────────
  const emailPromise =
    email != null
      ? Promise.resolve(email as string | null)
      : admin
          .from("users")
          .select("email")
          .eq("id", userId)
          .maybeSingle()
          .then((r) => (r.data as { email?: string } | null)?.email ?? null) as Promise<string | null>;

  const [membershipsRes, ownedStudiosRes, ownerGrantsRes, resolvedEmail] = await Promise.all([
    admin
      .from("staff_memberships")
      .select("studio_id, location_id, role, is_active")
      .eq("user_id", userId)
      .eq("is_active", true),
    admin.from("studios").select("id, contract_status").eq("owner_id", userId),
    admin
      .from("platform_owner_grants")
      .select("user_id, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    emailPromise,
  ]);

  const memberships = membershipsRes.data;
  const ownedStudios = ownedStudiosRes.data;
  const ownerGrants = ownerGrantsRes.data;
  const isSuperAdmin = isSuperAdminEmail(resolvedEmail);

  // ── Phase 2: contract-status batch (needs studioIds from Phase 1) ─────
  const allStudioIds = new Set<string>();
  for (const m of memberships ?? []) allStudioIds.add(m.studio_id);
  for (const s of ownedStudios ?? []) allStudioIds.add(s.id);

  const studioArrayForStatus = [...allStudioIds];
  const { data: studioStates } =
    studioArrayForStatus.length > 0
      ? await admin.from("studios").select("id, contract_status").in("id", studioArrayForStatus)
      : { data: [] as { id: string; contract_status: string | null }[] };

  const activeStudioIdSet = new Set(
    (studioStates ?? []).filter((s) => s.contract_status !== "suspended").map((s) => s.id),
  );

  // Build roles + memberships from Phase-1 + Phase-2 results
  const studioIds = new Set<string>();
  const roles = new Set<StaffRole>();
  const normalizedMemberships: AccessContext["memberships"] = [];
  let hasSuspendedBackofficeAccess = false;

  for (const m of memberships ?? []) {
    const role = (m.role as StaffRole) ?? "client";
    if (!activeStudioIdSet.has(m.studio_id)) {
      if (isBackofficeRole(role)) hasSuspendedBackofficeAccess = true;
      continue;
    }
    roles.add(role);
    studioIds.add(m.studio_id);
    normalizedMemberships.push({ studio_id: m.studio_id, location_id: m.location_id, role });
  }

  for (const s of ownedStudios ?? []) {
    if (!activeStudioIdSet.has(s.id)) {
      hasSuspendedBackofficeAccess = true;
      continue;
    }
    roles.add("owner");
    studioIds.add(s.id);
    normalizedMemberships.push({ studio_id: s.id, location_id: null, role: "owner" });
  }

  const hasAnyStudioAssociation = (memberships?.length ?? 0) > 0 || (ownedStudios?.length ?? 0) > 0;
  if (ownerGrants?.user_id && !hasAnyStudioAssociation) {
    roles.add("owner");
  }

  // ── Phase 3: locations (needs active studioIds) ───────────────────────
  const studioArray = [...studioIds];
  const { data: locations } =
    studioArray.length > 0
      ? await admin
          .from("locations")
          .select("id, studio_id, name, is_active")
          .in("studio_id", studioArray)
          .eq("is_active", true)
          .order("name")
      : { data: [] as { id: string; studio_id: string; name: string }[] };

  const locs = (locations ?? []).map((l) => ({
    id: l.id,
    studio_id: l.studio_id,
    name: l.name,
  }));

  const selected =
    selectedLocationId && locs.some((l) => l.id === selectedLocationId)
      ? selectedLocationId
      : null;

  return {
    userId,
    isSuperAdmin,
    roles: [...roles],
    memberships: normalizedMemberships,
    locations: locs,
    selectedLocationId: selected,
    hasSuspendedBackofficeAccess,
  } as SerializableAccessContext;
};

const buildAccessContextPersistent = unstable_cache(
  async (userId: string, email: string | null, selectedLocationId: string | null) =>
    buildAccessContextCore(userId, email, selectedLocationId),
  ["rbac-access-context-v1"],
  { revalidate: 30, tags: [RBAC_CACHE_TAG] },
);

export const buildAccessContext = cache(async (
  userId: string,
  email: string | null,
  selectedLocationId: string | null,
): Promise<AccessContext> => {
  const cached = await buildAccessContextPersistent(userId, email, selectedLocationId);
  return {
    ...cached,
    roles: new Set(cached.roles),
  } as AccessContext;
});

export async function resolveAccessContext(params: {
  userId: string;
  email?: string | null;
  selectedLocationId?: string | null;
}) {
  const ctx = await buildAccessContext(
    params.userId,
    params.email ?? null,
    params.selectedLocationId ?? null,
  );
  const role = bestRole(ctx);
  const hasBackofficeAccess =
    ctx.isSuperAdmin ||
    role === "owner" ||
    role === "manager" ||
    role === "frontdesk" ||
    role === "instructor";
  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  return {
    ctx,
    bestRole: role,
    hasBackofficeAccess,
    studioIds,
    hasSuspendedBackofficeAccess: ctx.hasSuspendedBackofficeAccess ?? false,
  };
}

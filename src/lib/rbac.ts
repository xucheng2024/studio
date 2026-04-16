import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/supabase/env";

export type StaffRole = "owner" | "manager" | "frontdesk" | "instructor" | "client";

export type LocationScope = {
  id: string;
  studio_id: string;
  name: string;
};

export type AccessContext = {
  userId: string;
  roles: Set<StaffRole>;
  memberships: { studio_id: string; location_id: string | null; role: StaffRole }[];
  locations: LocationScope[];
  selectedLocationId: string | null;
};

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

export async function buildAccessContext(params: {
  userId: string;
  selectedLocationId?: string | null;
}) {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for RBAC");
  const admin = createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: memberships } = await admin
    .from("staff_memberships")
    .select("studio_id, location_id, role, is_active")
    .eq("user_id", params.userId)
    .eq("is_active", true);

  const studioIds = new Set<string>();
  const roles = new Set<StaffRole>();
  const normalizedMemberships: AccessContext["memberships"] = [];
  for (const m of memberships ?? []) {
    const role = (m.role as StaffRole) ?? "client";
    roles.add(role);
    studioIds.add(m.studio_id);
    normalizedMemberships.push({
      studio_id: m.studio_id,
      location_id: m.location_id,
      role,
    });
  }

  const { data: ownedStudios } = await admin
    .from("studios")
    .select("id")
    .eq("owner_id", params.userId);

  for (const s of ownedStudios ?? []) {
    roles.add("owner");
    studioIds.add(s.id);
    normalizedMemberships.push({
      studio_id: s.id,
      location_id: null,
      role: "owner",
    });
  }

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
    params.selectedLocationId && locs.some((l) => l.id === params.selectedLocationId)
      ? params.selectedLocationId
      : null;

  return {
    userId: params.userId,
    roles,
    memberships: normalizedMemberships,
    locations: locs,
    selectedLocationId: selected,
  } as AccessContext;
}

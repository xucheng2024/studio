import { getDashboardScopeForRoles } from "@/lib/dashboard";
import {
  requireGlobalStaffScope,
  type StaffScopeFailureReason,
} from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export type SalonCustomerStatus = "active" | "inactive" | "blocked";
export type SalonCustomerSource = "online" | "frontdesk" | "walk_in" | "imported";

export type SalonCustomer = {
  id: string;
  studio_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: SalonCustomerStatus;
  source: SalonCustomerSource;
  preferred_location_id: string | null;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SalonCustomerDuplicateCandidate = { id: string; matched_on: "email" | "phone" };

const CUSTOMER_GLOBAL_ROLES = ["owner", "manager"] as const;

/**
 * Only Owner / studio-wide Manager can see the full Studio customer roster
 * today. Location-scoped staff (including Frontdesk) are conservatively
 * denied rather than scoped by "has a business relationship with this
 * location" — FND-02 has no Appointment/Payment/etc. data yet to check that
 * relationship against. Revisit once APT-0x/CRM-01 land real relationships.
 */
function hasGlobalCustomerReadAccess(
  memberships: Array<{ studio_id: string; location_id: string | null; role: string }>,
  studioId: string,
) {
  return memberships.some(
    (membership) =>
      membership.studio_id === studioId &&
      membership.location_id == null &&
      (membership.role === "owner" || membership.role === "manager"),
  );
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim();
  return trimmed ? trimmed : null;
}

async function recordDuplicateCandidates(params: {
  studioId: string;
  customerId: string;
  email: string | null;
  phone: string | null;
}): Promise<SalonCustomerDuplicateCandidate[]> {
  const admin = createAdminClient();
  const candidates: SalonCustomerDuplicateCandidate[] = [];

  if (params.email) {
    const { data } = await admin
      .from("salon_customers")
      .select("id")
      .eq("studio_id", params.studioId)
      .neq("id", params.customerId)
      .is("merged_into_id", null)
      .ilike("email", params.email);
    for (const row of data ?? []) {
      candidates.push({ id: (row as { id: string }).id, matched_on: "email" });
      const { error } = await admin.from("salon_customer_migration_conflicts").insert(
        {
          studio_id: params.studioId,
          source_type: "salon_customer",
          source_id: params.customerId,
          conflict_code: "duplicate_email_in_studio",
          details: { email: params.email, matched_customer_id: (row as { id: string }).id },
        },
      );
      if (error && error.code !== "23505") throw error;
    }
  }

  if (params.phone) {
    const { data } = await admin
      .from("salon_customers")
      .select("id")
      .eq("studio_id", params.studioId)
      .neq("id", params.customerId)
      .is("merged_into_id", null)
      .eq("phone", params.phone);
    for (const row of data ?? []) {
      candidates.push({ id: (row as { id: string }).id, matched_on: "phone" });
      const { error } = await admin.from("salon_customer_migration_conflicts").insert(
        {
          studio_id: params.studioId,
          source_type: "salon_customer",
          source_id: params.customerId,
          conflict_code: "duplicate_phone_in_studio",
          details: { phone: params.phone, matched_customer_id: (row as { id: string }).id },
        },
      );
      if (error && error.code !== "23505") throw error;
    }
  }

  return candidates;
}

/**
 * List salon_customers within the caller's authorised studio scope.
 * Temporary conservative policy: only Owner / all-location Manager get a
 * result; every other role is forbidden (see hasGlobalCustomerReadAccess).
 */
export async function listSalonCustomersInScope(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
}): Promise<{ ok: true; customers: SalonCustomer[] } | { ok: false; reason: "forbidden" }> {
  const scope = await getDashboardScopeForRoles(
    {
      userId: params.userId,
      email: params.email ?? null,
      studioId: params.studioId,
      locationId: params.locationId ?? null,
    },
    [...CUSTOMER_GLOBAL_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }
  if (!hasGlobalCustomerReadAccess(scope.ctx.memberships, params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_customers")
    .select("*")
    .eq("studio_id", params.studioId)
    .is("merged_into_id", null)
    .order("full_name")
    .returns<SalonCustomer[]>();
  if (error) throw error;
  return { ok: true, customers: data ?? [] };
}

/**
 * Fetch one salon_customer: the customer's own login, or a caller with
 * global (Owner / all-location Manager) read access. Location-scoped staff
 * are conservatively denied — see listSalonCustomersInScope.
 */
export async function getSalonCustomerById(params: {
  userId: string;
  studioId: string;
  customerId: string;
}): Promise<
  | { ok: true; customer: SalonCustomer }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  const admin = createAdminClient();
  const { data: customer, error } = await admin
    .from("salon_customers")
    .select("*")
    .eq("id", params.customerId)
    .eq("studio_id", params.studioId)
    .maybeSingle<SalonCustomer>();
  if (error) throw error;
  if (!customer) return { ok: false, reason: "not_found" };

  if (customer.user_id === params.userId) {
    return { ok: true, customer };
  }

  const scope = await getDashboardScopeForRoles(
    { userId: params.userId, studioId: params.studioId },
    [...CUSTOMER_GLOBAL_ROLES],
  );
  if (!scope.studioIds.includes(params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }
  if (!hasGlobalCustomerReadAccess(scope.ctx.memberships, params.studioId)) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, customer };
}

export type CreateSalonCustomerInput = {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  source: SalonCustomerSource;
  status?: SalonCustomerStatus;
  preferredLocationId?: string | null;
};

export async function createSalonCustomer(params: {
  userId: string;
  studioId: string;
  input: CreateSalonCustomerInput;
}): Promise<
  | { ok: true; customer: SalonCustomer; duplicateCandidates: SalonCustomerDuplicateCandidate[] }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...CUSTOMER_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const fullName = params.input.fullName.trim();
  if (!fullName) return { ok: false, reason: "invalid_request", message: "full_name_required" };

  const email = normalizeEmail(params.input.email);
  const phone = normalizePhone(params.input.phone);

  const admin = createAdminClient();
  const { data: customer, error } = await admin
    .from("salon_customers")
    .insert({
      studio_id: params.studioId,
      full_name: fullName,
      email,
      phone,
      source: params.input.source,
      status: params.input.status ?? "active",
      preferred_location_id: params.input.preferredLocationId ?? null,
    })
    .select("*")
    .single<SalonCustomer>();
  if (error) return { ok: false, reason: "invalid_request", message: error.message };

  const duplicateCandidates = await recordDuplicateCandidates({
    studioId: params.studioId,
    customerId: customer.id,
    email,
    phone,
  });

  return { ok: true, customer, duplicateCandidates };
}

export type UpdateSalonCustomerPatch = Partial<{
  fullName: string;
  email: string | null;
  phone: string | null;
  status: SalonCustomerStatus;
  source: SalonCustomerSource;
  preferredLocationId: string | null;
}>;

export async function updateSalonCustomer(params: {
  userId: string;
  studioId: string;
  customerId: string;
  patch: UpdateSalonCustomerPatch;
}): Promise<
  | { ok: true; customer: SalonCustomer; duplicateCandidates: SalonCustomerDuplicateCandidate[] }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: [...CUSTOMER_GLOBAL_ROLES],
  });
  if (!scope.ok) return scope;

  const update: Record<string, unknown> = {};
  let email: string | null | undefined;
  let phone: string | null | undefined;

  if (params.patch.fullName !== undefined) {
    const fullName = params.patch.fullName.trim();
    if (!fullName) return { ok: false, reason: "invalid_request", message: "full_name_required" };
    update.full_name = fullName;
  }
  if (params.patch.email !== undefined) {
    email = normalizeEmail(params.patch.email);
    update.email = email;
  }
  if (params.patch.phone !== undefined) {
    phone = normalizePhone(params.patch.phone);
    update.phone = phone;
  }
  if (params.patch.status !== undefined) update.status = params.patch.status;
  if (params.patch.source !== undefined) update.source = params.patch.source;
  if (params.patch.preferredLocationId !== undefined) {
    update.preferred_location_id = params.patch.preferredLocationId;
  }
  if (Object.keys(update).length === 0) {
    return { ok: false, reason: "invalid_request", message: "empty_patch" };
  }

  const admin = createAdminClient();
  const { data: customer, error } = await admin
    .from("salon_customers")
    .update(update)
    .eq("id", params.customerId)
    .eq("studio_id", params.studioId)
    .is("merged_into_id", null)
    .select("*")
    .single<SalonCustomer>();
  if (error) return { ok: false, reason: "invalid_request", message: error.message };

  const duplicateCandidates =
    email !== undefined || phone !== undefined
      ? await recordDuplicateCandidates({
          studioId: params.studioId,
          customerId: customer.id,
          email: email !== undefined ? email : customer.email,
          phone: phone !== undefined ? phone : customer.phone,
        })
      : [];

  return { ok: true, customer, duplicateCandidates };
}

/**
 * Human-confirmed merge only — Owner/all-location Manager, never automatic
 * on name/email/phone. Delegates to the merge_salon_customers RPC, which
 * keeps the source row (flagged via merged_into_id) and writes an audit
 * snapshot to salon_customer_merge_audits.
 */
export async function confirmSalonCustomerMerge(params: {
  userId: string;
  studioId: string;
  sourceCustomerId: string;
  targetCustomerId: string;
  reason?: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { error } = await admin.rpc("merge_salon_customers", {
    p_studio_id: params.studioId,
    p_source_customer_id: params.sourceCustomerId,
    p_target_customer_id: params.targetCustomerId,
    p_actor_id: params.userId,
    p_reason: params.reason ?? null,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

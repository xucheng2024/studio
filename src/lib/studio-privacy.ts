import "server-only";

import { createHash } from "node:crypto";
import { requireGlobalStaffScope, type StaffScopeFailureReason } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_RETENTION_DAYS = 1825;
export const PRIVACY_NOTICE_TEMPLATE_ID = "studio-privacy-template-v1";

export type PrivacyNoticeSnapshot = {
  templateId: string;
  collected: string[];
  purposes: string[];
  processors: Array<{ name: string; purpose: string }>;
  body: string;
};

export type PrivacyNoticeVersion = {
  id: string;
  version_label: string;
  content_hash: string;
  content_snapshot: PrivacyNoticeSnapshot | Record<string, unknown>;
  is_active: boolean;
  published_at: string;
};

export type PrivacyProcessor = {
  key: "supabase" | "hitpay" | "resend";
  name: string;
  purpose: string;
  dataInvolved: string;
  siteUrl: string;
  enabled: boolean;
};

export function buildPrivacyNoticeSnapshot(): PrivacyNoticeSnapshot {
  return {
    templateId: PRIVACY_NOTICE_TEMPLATE_ID,
    collected: [
      "Name",
      "Email address",
      "Phone number",
      "Appointment date, time, service, and staff",
      "Health, allergy, and preference notes if you provide them",
    ],
    purposes: [
      "Booking and delivering salon services",
      "Taking payment and issuing receipts",
      "Operational contact about your appointment",
    ],
    processors: [
      { name: "Supabase", purpose: "Hosting, database, and authentication" },
      { name: "HitPay", purpose: "Online payments" },
      { name: "Resend", purpose: "Transactional and marketing email" },
    ],
    body: "This studio collects the personal data listed here to run appointments, payments, and service records. Data is used by this studio. Payment data is processed by HitPay, email is sent with Resend, and records are stored with Supabase. You can ask staff to view or correct your record, or to deactivate and mask it after you leave or when the retention period ends.",
  };
}

export function hashPrivacyNoticeSnapshot(snapshot: PrivacyNoticeSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function nextPrivacyNoticeVersionLabel(existingCount: number) {
  return `privacy-v${existingCount + 1}.0`;
}

export async function getLatestPrivacyNotice(params: { studioId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_privacy_notice_versions")
    .select("id, version_label, content_hash, content_snapshot, is_active, published_at")
    .eq("studio_id", params.studioId)
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<PrivacyNoticeVersion>();
  if (error) throw error;
  return data;
}

export async function listPrivacyNoticeVersions(params: { studioId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("salon_privacy_notice_versions")
    .select("id, version_label, content_hash, content_snapshot, is_active, published_at")
    .eq("studio_id", params.studioId)
    .order("published_at", { ascending: false })
    .limit(20)
    .returns<PrivacyNoticeVersion[]>();
  if (error) throw error;
  return data ?? [];
}

export async function publishPrivacyNotice(params: {
  userId: string;
  studioId: string;
}): Promise<{ ok: true; versionLabel: string } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const snapshot = buildPrivacyNoticeSnapshot();
  const contentHash = hashPrivacyNoticeSnapshot(snapshot);
  const existing = await listPrivacyNoticeVersions({ studioId: params.studioId });
  if (existing.some((row) => row.content_hash === contentHash && row.is_active)) {
    return { ok: true, versionLabel: existing.find((row) => row.content_hash === contentHash)?.version_label ?? "privacy-v1.0" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("publish_salon_privacy_notice", {
    p_studio_id: params.studioId,
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_version_label: nextPrivacyNoticeVersionLabel(existing.length),
    p_content_hash: contentHash,
    p_content_snapshot: snapshot,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  const payload = data as { ok?: boolean; versionLabel?: string };
  if (!payload?.ok || !payload.versionLabel) {
    return { ok: false, reason: "invalid_request", message: "publish_failed" };
  }
  return { ok: true, versionLabel: payload.versionLabel };
}

export async function getStudioPrivacySettings(params: { studioId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studios")
    .select("id, name, public_slug, customer_retention_days, appointment_retention_days, hitpay_enabled, resend_enabled")
    .eq("id", params.studioId)
    .maybeSingle<{
      id: string;
      name: string;
      public_slug: string | null;
      customer_retention_days: number | null;
      appointment_retention_days: number | null;
      hitpay_enabled: boolean | null;
      resend_enabled: boolean | null;
    }>();
  if (error) throw error;
  return data;
}

export function studioProcessorCatalog(params: {
  hitpayEnabled: boolean;
  resendEnabled: boolean;
}): PrivacyProcessor[] {
  return [
    {
      key: "supabase",
      name: "Supabase",
      purpose: "Hosting, database, and authentication",
      dataInvolved: "Account, customer, appointment, and operational records",
      siteUrl: "https://supabase.com",
      enabled: true,
    },
    {
      key: "hitpay",
      name: "HitPay",
      purpose: "Online payments and refunds",
      dataInvolved: "Name, email, payment amount, and payment identifiers",
      siteUrl: "https://hit-pay.com",
      enabled: params.hitpayEnabled,
    },
    {
      key: "resend",
      name: "Resend",
      purpose: "Transactional and marketing email",
      dataInvolved: "Name, email, and message content",
      siteUrl: "https://resend.com",
      enabled: params.resendEnabled,
    },
  ];
}

export async function updateStudioRetentionSettings(params: {
  userId: string;
  studioId: string;
  customerRetentionDays: number;
  appointmentRetentionDays: number;
}): Promise<{ ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;
  if (
    !Number.isInteger(params.customerRetentionDays)
    || !Number.isInteger(params.appointmentRetentionDays)
    || params.customerRetentionDays < 1
    || params.appointmentRetentionDays < 1
    || params.customerRetentionDays > 36500
    || params.appointmentRetentionDays > 36500
  ) {
    return { ok: false, reason: "invalid_request", message: "Retention days must be between 1 and 36500." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("studios")
    .update({
      customer_retention_days: params.customerRetentionDays,
      appointment_retention_days: params.appointmentRetentionDays,
    })
    .eq("id", params.studioId);
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  return { ok: true };
}

export type RetentionCustomerRow = {
  id: string;
  full_name: string;
  status: string;
  last_activity_at: string;
  anonymized_at: string | null;
};

export type RetentionAppointmentRow = {
  id: string;
  salon_customer_id: string;
  customer_name: string;
  starts_at: string;
  status: string;
  service_title_snapshot: string | null;
};

export async function listRetentionQueue(params: {
  userId: string;
  studioId: string;
}): Promise<
  | { ok: true; customers: RetentionCustomerRow[]; appointments: RetentionAppointmentRow[]; customerDays: number; appointmentDays: number }
  | { ok: false; reason: StaffScopeFailureReason | "invalid_request" }
> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const settings = await getStudioPrivacySettings({ studioId: params.studioId });
  const customerDays = settings?.customer_retention_days ?? DEFAULT_RETENTION_DAYS;
  const appointmentDays = settings?.appointment_retention_days ?? DEFAULT_RETENTION_DAYS;
  const customerCutoff = new Date(Date.now() - customerDays * 24 * 60 * 60 * 1000).toISOString();
  const appointmentCutoff = new Date(Date.now() - appointmentDays * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  const [{ data: customers, error: customerError }, { data: appointments, error: appointmentError }] = await Promise.all([
    admin
      .from("salon_customers")
      .select("id, full_name, status, updated_at, created_at, anonymized_at")
      .eq("studio_id", params.studioId)
      .is("merged_into_id", null)
      .is("anonymized_at", null)
      .limit(200),
    admin
      .from("salon_appointments")
      .select("id, salon_customer_id, starts_at, status, service_title_snapshot, salon_customers(full_name)")
      .eq("studio_id", params.studioId)
      .is("retention_reviewed_at", null)
      .lt("starts_at", appointmentCutoff)
      .neq("status", "pending")
      .order("starts_at", { ascending: true })
      .limit(100),
  ]);
  if (customerError) throw customerError;
  if (appointmentError) throw appointmentError;

  const customerIds = (customers ?? []).map((row) => row.id as string);
  const lastActivityByCustomer = new Map<string, string>();
  if (customerIds.length) {
    const { data: lastAppointments, error: lastError } = await admin
      .from("salon_appointments")
      .select("salon_customer_id, starts_at")
      .eq("studio_id", params.studioId)
      .in("salon_customer_id", customerIds)
      .order("starts_at", { ascending: false });
    if (lastError) throw lastError;
    for (const row of lastAppointments ?? []) {
      const customerId = row.salon_customer_id as string;
      if (!lastActivityByCustomer.has(customerId)) {
        lastActivityByCustomer.set(customerId, String(row.starts_at));
      }
    }
  }

  const dueCustomers: RetentionCustomerRow[] = (customers ?? []).flatMap((row) => {
    const lastActivity = lastActivityByCustomer.get(row.id as string)
      ?? String(row.updated_at ?? row.created_at);
    if (lastActivity > customerCutoff) return [];
    return [{
      id: row.id as string,
      full_name: String(row.full_name),
      status: String(row.status),
      last_activity_at: lastActivity,
      anonymized_at: (row.anonymized_at as string | null) ?? null,
    }];
  });

  return {
    ok: true,
    customerDays,
    appointmentDays,
    customers: dueCustomers.slice(0, 50),
    appointments: (appointments ?? []).map((row) => {
      const linked = row.salon_customers as { full_name?: string } | { full_name?: string }[] | null;
      const customerName = Array.isArray(linked) ? linked[0]?.full_name : linked?.full_name;
      return {
        id: row.id as string,
        salon_customer_id: row.salon_customer_id as string,
        customer_name: customerName ?? "Customer",
        starts_at: String(row.starts_at),
        status: String(row.status),
        service_title_snapshot: (row.service_title_snapshot as string | null) ?? null,
      };
    }),
  };
}

export async function markAppointmentRetentionReviewed(params: {
  userId: string;
  studioId: string;
  appointmentId: string;
}): Promise<{ ok: true } | { ok: false; reason: StaffScopeFailureReason | "invalid_request"; message?: string }> {
  const scope = await requireGlobalStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    roles: ["owner", "manager"],
  });
  if (!scope.ok) return scope;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mark_salon_appointment_retention_reviewed", {
    p_studio_id: params.studioId,
    p_appointment_id: params.appointmentId,
    p_actor_id: params.userId,
    p_actor_role: scope.role,
  });
  if (error) return { ok: false, reason: "invalid_request", message: error.message };
  const payload = data as { ok?: boolean };
  if (!payload?.ok) return { ok: false, reason: "invalid_request", message: "review_failed" };
  return { ok: true };
}

export async function recordSelfPrivacyNoticeConsent(params: {
  userId: string;
  studioId: string;
  customerId: string;
  textVersion: string;
  noticeVersionId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_salon_customer_privacy_consent", {
    p_studio_id: params.studioId,
    p_salon_customer_id: params.customerId,
    p_actor_id: params.userId,
    p_actor_role: "client",
    p_status: "granted",
    p_source: "client_portal",
    p_text_version: params.textVersion,
    p_evidence: { noticeVersionId: params.noticeVersionId },
    p_occurred_at: new Date().toISOString(),
    p_location_id: null,
    p_correlation_id: null,
    p_idempotency_key_id: null,
    p_idempotency_claim_token: null,
  });
  if (error) return { ok: false, message: error.message };
  const payload = data as { ok?: boolean; reason?: string };
  if (!payload?.ok) return { ok: false, message: payload?.reason ?? "privacy_consent_failed" };
  return { ok: true };
}

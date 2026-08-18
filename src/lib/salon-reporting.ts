import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeReportingFacts, type ReportingFacts } from "@/lib/salon-reporting-model";

export async function getSalonReportingFacts(params: {
  studioId: string;
  dateFrom: string;
  dateTo: string;
  locationId?: string | null;
  unassigned?: boolean;
  employeeId?: string | null;
  serviceId?: string | null;
}): Promise<ReportingFacts> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_rpt01_reporting_facts", {
    p_studio_id: params.studioId,
    p_from: params.dateFrom,
    p_to: params.dateTo,
    p_location_id: params.unassigned ? null : (params.locationId ?? null),
    p_unassigned: Boolean(params.unassigned),
    p_employee_id: params.employeeId ?? null,
    p_service_id: params.serviceId ?? null,
  });
  if (error) {
    console.error("[RPT-01] get_rpt01_reporting_facts failed", {
      studioId: params.studioId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      locationId: params.locationId ?? null,
      unassigned: Boolean(params.unassigned),
      employeeId: params.employeeId ?? null,
      serviceId: params.serviceId ?? null,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
  console.log("[RPT-01] get_rpt01_reporting_facts ok", {
    studioId: params.studioId,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    hasData: Boolean(data),
  });
  return normalizeReportingFacts(data);
}

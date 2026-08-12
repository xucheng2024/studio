"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ui } from "@/lib/ui";

type QueueStatus = "pending" | "processing" | "sent" | "failed" | "invalidated";

type QueueRow = {
  id: string;
  appointment_id: string;
  event_type: string;
  recipient_email: string | null;
  status: QueueStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

function statusBadge(status: QueueStatus) {
  if (status === "sent") return ui.badge;
  if (status === "failed" || status === "invalidated") return ui.badgeRed;
  if (status === "pending") return ui.badgeAmber;
  return ui.badgeNeutral;
}

function eventLabel(eventType: string) {
  return eventType.replaceAll("appointment_", "").replaceAll("_", " ");
}

export function AppointmentNotificationOpsPanel(props: {
  studioId: string;
  locationId: string | null;
  canRetry: boolean;
  requiresLocationSelection: boolean;
}) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [recentlyRetriedJobId, setRecentlyRetriedJobId] = useState<string | null>(null);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("studio_id", props.studioId);
    if (props.locationId) sp.set("location_id", props.locationId);
    sp.set("limit", "30");
    return sp.toString();
  }, [props.locationId, props.studioId]);

  const loadRows = useCallback(async () => {
    if (props.requiresLocationSelection) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/operations/appointments/notifications?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http_${response.status}`);
      }
      const payload = (await response.json()) as { rows?: QueueRow[] };
      setRows(payload.rows ?? []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`Failed to load notification logs: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [props.requiresLocationSelection, query]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!recentlyRetriedJobId) return;
    const timer = setTimeout(() => {
      setRecentlyRetriedJobId(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [recentlyRetriedJobId]);

  async function handleRetry(jobId: string) {
    setRetryingJobId(jobId);
    setToast(null);
    try {
      const response = await fetch("/api/operations/appointments/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio_id: props.studioId, job_id: jobId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
        status?: string;
      };

      if (!response.ok || !body.ok) {
        throw new Error(body.reason ?? body.error ?? `http_${response.status}`);
      }

      setToast(`Retry queued (${body.status ?? "pending"}).`);
      setRecentlyRetriedJobId(jobId);
      await loadRows();
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      setToast(`Retry failed: ${message}`);
    } finally {
      setRetryingJobId(null);
    }
  }

  return (
    <section className={ui.card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className={ui.h2}>Appointment Email Notifications</h2>
          <p className={ui.muted}>Latest queue logs and manual retry controls.</p>
        </div>
        <button
          type="button"
          className={ui.btnSecondarySm}
          onClick={() => void loadRows()}
          disabled={loading || props.requiresLocationSelection}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {props.requiresLocationSelection ? (
        <p className={`mt-3 ${ui.muted}`}>Select a location to view notification logs.</p>
      ) : null}

      {error ? <p className={`mt-3 ${ui.error}`}>{error}</p> : null}
      {toast ? <p className={`mt-3 ${toast.startsWith("Retry queued") ? ui.success : ui.error}`}>{toast}</p> : null}

      {!props.requiresLocationSelection && rows.length === 0 && !loading ? (
        <p className={`mt-3 ${ui.muted}`}>No notification jobs yet.</p>
      ) : null}

      {!props.requiresLocationSelection && rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Recipient</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2 pr-3">Last Error</th>
                <th className="py-2 pr-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canRetryRow = props.canRetry && (row.status === "failed" || row.status === "invalidated");
                const isRecentlyRetried = recentlyRetriedJobId === row.id;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-stone-100 align-top transition-colors dark:border-stone-900 ${
                      isRecentlyRetried
                        ? "bg-teal-50/70 dark:bg-teal-900/20"
                        : "bg-transparent"
                    }`}
                  >
                    <td className="py-2 pr-3 text-stone-800 dark:text-stone-200">{eventLabel(row.event_type)}</td>
                    <td className="py-2 pr-3 text-stone-600 dark:text-stone-300">{row.recipient_email ?? "-"}</td>
                    <td className="py-2 pr-3"><span className={statusBadge(row.status)}>{row.status}</span></td>
                    <td className="py-2 pr-3 text-stone-600 dark:text-stone-300">
                      {row.attempt_count}/{row.max_attempts}
                    </td>
                    <td className="max-w-[18rem] py-2 pr-3 text-xs text-stone-500 dark:text-stone-400">{row.last_error ?? "-"}</td>
                    <td className="py-2 pr-3">
                      {canRetryRow ? (
                        <button
                          type="button"
                          className={ui.btnSecondarySm}
                          onClick={() => void handleRetry(row.id)}
                          disabled={retryingJobId === row.id}
                        >
                          {retryingJobId === row.id ? "Retrying..." : "Retry"}
                        </button>
                      ) : (
                        <span className={ui.muted}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!props.canRetry ? (
        <p className={`mt-3 text-xs ${ui.muted}`}>Manual retry requires Owner or Manager role.</p>
      ) : null}
    </section>
  );
}

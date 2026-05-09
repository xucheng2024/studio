type RpcCapable = {
  rpc: (fn: string, args?: Record<string, unknown>) => unknown;
};

/**
 * Opportunistically expires stale pending payments so seats are released
 * without relying solely on webhooks/manual ops.
 */
export async function sweepExpiredPendingPayments(admin: RpcCapable) {
  try {
    const result = (await admin.rpc("expire_pending_payments")) as {
      data?: unknown;
      error?: { message?: string } | null;
    };
    const { data, error } = result;
    if (error) return 0;
    const count = Number(data ?? 0);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

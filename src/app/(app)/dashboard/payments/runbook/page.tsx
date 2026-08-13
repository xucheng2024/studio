import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

export default async function HitpayPendingRunbookPage({ searchParams }: Props) {
  const sp = await searchParams;
  const requestedLocationId = sp.location_id && sp.location_id !== "__unassigned" ? sp.location_id : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: requestedLocationId,
  }, ["owner", "manager", "frontdesk"]);

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this runbook.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const allowsStudioLevelLocationFilter = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const locationFilter =
    sp.location_id === "__unassigned" && allowsStudioLevelLocationFilter
      ? "__unassigned"
      : selectedLocationId;

  const paymentsHref = `/dashboard/payments?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const pendingHitpayHref = `${paymentsHref}&attention=pending_hitpay`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={ui.h1}>Runbook · 客户已支付但系统仍 Pending</h1>
        <DashboardAppLink href={paymentsHref} className={ui.btnSecondarySm}>
          Back to payments
        </DashboardAppLink>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>适用场景</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>客户出示已支付截图，但 Payment 仍是 pending。</li>
          <li>POS 明细页显示 pending_payment，且支付方式为 HitPay。</li>
          <li>怀疑 webhook 延迟或偶发失败。</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>标准处理步骤（SOP）</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            先打开
            <DashboardAppLink href={pendingHitpayHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Pending HitPay (7d)
            </DashboardAppLink>
            ，确认目标 payment 仍为 pending。
          </li>
          <li>核对参考信息：金额、客户名、支付时间、reference code（或 POS sale id）。</li>
          <li>
            在 Payments 列表或 POS sale detail 的 payment records 点击 <span className={ui.code}>Sync HitPay</span>。
          </li>
          <li>等待刷新并确认 payment 变更为 paid（或 refunded/failed），再执行后续业务动作。</li>
          <li>若仍 pending，2 分钟后再同步 1 次（避免重复频繁点击）。</li>
          <li>若两次同步仍异常，立即查看 Payments 页的 <span className={ui.code}>HitPay webhook exceptions (24h)</span> 看板。</li>
          <li>
            若看板出现 <span className={ui.code}>invalid_signature</span> / <span className={ui.code}>provider_event_claim_failed</span> /
            <span className={ui.code}>complete_pos_hitpay_sale_failed</span>，升级给值班研发并附上 payment id、event id、时间点。
          </li>
        </ol>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>禁止事项</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>未核实入账前，不要直接手动改 paid 或重复创建新 payment。</li>
          <li>同一客户同一笔订单，不要同时让多人重复点击 Sync。</li>
          <li>看到异常码后不要跳过升级流程，以免漏账或重复入账。</li>
        </ul>
      </section>
    </div>
  );
}

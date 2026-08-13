import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

export default async function PosOperationsRunbookPage({ searchParams }: Props) {
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

  const posHref = `/dashboard/pos?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const paymentsHref = `/dashboard/payments?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const cashSessionsHref = `/dashboard/pos/cash-sessions?studio_id=${activeStudioId}${locationFilter && locationFilter !== "__unassigned" ? `&location_id=${locationFilter}` : ""}`;
  const pendingPosCashHref = `${paymentsHref}&attention=pending_pos_cash`;
  const unassignedCashHref = `${paymentsHref}&unassigned_cash=1&payment_method=cash&source=pos_sale`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={ui.h1}>Runbook · POS-04 现金班次日常 SOP</h1>
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={posHref} className={ui.btnSecondarySm}>
            Back to POS
          </DashboardAppLink>
          <DashboardAppLink href={cashSessionsHref} className={ui.btnSecondarySm}>
            Cash sessions
          </DashboardAppLink>
          <DashboardAppLink href={paymentsHref} className={ui.btnSecondarySm}>
            Back to payments
          </DashboardAppLink>
        </div>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>适用场景</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>门店按班次处理 POS 现金单：开班、收款、关班、复盘差异。</li>
          <li>Payments/POS 顶部出现“无 open cash session”提示，前台不确定是否可收现金。</li>
          <li>Payments 出现已 paid/refunded 但 <span className={ui.code}>cash_session_id</span> 为空的异常现金单。</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>标准流程（开班 → 收款 → 关班 → 差异处理）</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            <span className="font-medium">开班前检查：</span>
            在 POS 或 Payments 顶部先看“open cash session”状态；若未开班，先到
            <DashboardAppLink href={cashSessionsHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Cash sessions
            </DashboardAppLink>
            开班。
          </li>
          <li><span className="font-medium">开班：</span>选择正确 location，记录 opening float；同一 location 只允许 1 个 <span className={ui.code}>open</span> 班次。</li>
          <li><span className="font-medium">收款：</span>POS sale 到 <span className={ui.code}>pending_payment</span> 后执行现金收款；系统会自动把 payment 绑定到当前 open session。</li>
          <li><span className="font-medium">收款异常：</span>若提示 <span className={ui.code}>no open cash session for location</span>，不要重试提交，先开班后再收款。</li>
          <li><span className="font-medium">关班：</span>班次结束在 cash session 详情输入 counted cash 并关班，系统自动计算 <span className={ui.code}>cash_in/cash_out/expected_cash/cash_over_short</span>。</li>
          <li><span className="font-medium">差异处理：</span>若 <span className={ui.code}>cash_over_short != 0</span>，先核对退款与手工收支，再记录说明并由店长复核。</li>
        </ol>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>日常核对清单（班后 5 分钟内）</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            打开
            <DashboardAppLink href={pendingPosCashHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Pending POS Cash (7d)
            </DashboardAppLink>
            ，确认没有遗留 pending 现金单。
          </li>
          <li>
            打开
            <DashboardAppLink href={unassignedCashHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Unassigned POS Cash
            </DashboardAppLink>
            ，确认没有 paid/refunded 但未挂班次的现金单。
          </li>
          <li>检查当班退款单是否都落在正确班次，避免把前后班次现金混算。</li>
          <li>若当天有手工补录、作废或退款，必须在关班 notes 写明原因与经办人。</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>异常升级与禁止事项</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>不要直接改数据库补 <span className={ui.code}>cash_session_id</span> 或篡改现金汇总字段。</li>
          <li>同一笔 sale/payment 不要多人并发处理，避免重复收款或重复退款。</li>
          <li>同一异常最多重试 1 次；仍失败请升级研发并附上 sale id、payment id、session id、失败时间。</li>
        </ul>
      </section>
    </div>
  );
}

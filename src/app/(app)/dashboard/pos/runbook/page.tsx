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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={ui.h1}>Runbook · POS-04 作废/部分退款排障 SOP</h1>
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={posHref} className={ui.btnSecondarySm}>
            Back to POS
          </DashboardAppLink>
          <DashboardAppLink href={paymentsHref} className={ui.btnSecondarySm}>
            Back to payments
          </DashboardAppLink>
        </div>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>适用场景</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>前台要取消未收款单据（Void）。</li>
          <li>客户已收款后需要整单或明细退款（Refund / Refund items）。</li>
          <li>看板出现 <span className={ui.code}>void_pos_sale_failed</span>、<span className={ui.code}>refund_pos_sale_failed</span> 或 <span className={ui.code}>refund_pos_sale_items_failed</span>。</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>标准处理步骤（SOP）</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>先确认销售单当前状态：<span className={ui.code}>draft/pending_payment</span> 才能 Void；<span className={ui.code}>paid/partially_refunded</span> 才能走明细退款。</li>
          <li>优先在 POS 明细页执行，避免在多个页面同时操作同一 sale/payment。</li>
          <li>做明细退款时：勾选行项目，且每行只填 <span className={ui.code}>refund qty</span> 或 <span className={ui.code}>refund amount</span> 其中一项。</li>
          <li>提交前确认剩余可退额度（行级与整单）足够，避免超额退款。</li>
          <li>执行失败后，立即打开 Payments 页 <span className={ui.code}>Payments/POS exceptions (24h)</span> 看板，定位失败码与时间点。</li>
          <li>若是 <span className={ui.code}>void_pos_sale_failed</span>：检查 sale/payment 是否已被其他人先处理（状态是否已变化）。</li>
          <li>若是 <span className={ui.code}>refund_pos_sale_failed</span>：检查支付方式、网关退款条件、invoice 状态与是否已退款。</li>
          <li>若是 <span className={ui.code}>refund_pos_sale_items_failed</span>：检查是否选错行、输入了 qty+amount 双值、或超出剩余额度。</li>
          <li>同一单据最多重试 1 次；仍失败则升级给研发并附上 sale id、payment id、失败码、发生时间。</li>
        </ol>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>常见失败码解释</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li><span className={ui.code}>void_pos_sale_failed</span>：通常是状态不允许作废，或支付状态已不是 pending。</li>
          <li><span className={ui.code}>refund_pos_sale_failed</span>：通常是网关不支持自动退款、退款窗口限制，或业务前置条件未满足。</li>
          <li><span className={ui.code}>refund_pos_sale_items_failed</span>：通常是明细超额退款、单行同时填 qty/amount，或 sale/payment 状态不匹配。</li>
          <li><span className={ui.code}>manual_refund_required</span>：需在网关后台手工退款后，再回系统核对状态。</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>禁止事项</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>不要直接改数据库状态绕过流程。</li>
          <li>不要多人并发处理同一 sale/payment。</li>
          <li>失败后不要无限重试，必须先看失败码再处理。</li>
        </ul>
      </section>
    </div>
  );
}

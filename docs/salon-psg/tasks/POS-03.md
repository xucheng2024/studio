# POS-03：HitPay 在线支付闭环（Batch 1 + Batch 2）

状态：已验证/待上线（Batch 1/2；专用 Free cloud Sandbox UAT 已通过）

负责人：Codex

开始日期：2026-08-13

Commit / Release：`8c402c3`、`1c0704f`、`ccc9f79`、`f8188f6`；未上线

## 1. 目标

打通 `pending_payment` POS 单的最小 HitPay 在线支付闭环：

- POS 单可创建 HitPay payment request 并跳转收款
- HitPay 成功回调后，同事务推进 `payments` 与 `pos_sales` 到 `paid`
- Webhook 重放幂等：重复回调不重复入账、不重复审计
- 支持强审计追踪（provider event + POS 状态前后快照）

## 2. 本批范围（Batch 1）

- 数据库事务 RPC：`complete_pos_hitpay_sale`（支持 `payment_id` / `sale_id`）
- API：
  - `POST /api/pos/payments/hitpay/create`
  - `POST /api/webhooks/hitpay`（对齐现有 `/api/payment/hitpay/webhook`）
- Dashboard POS 明细页：
  - `pending_payment` 新增 `Pay with HitPay` 按钮
  - 支付状态文案收敛为 `pending / paid / failed`
- DB 验证：`scripts/sql/verify_pos03_hitpay_webhook.sql`
  - 成功回写 `payments + pos_sales`
  - 幂等重放不重复审计

## 3. 本批不做

- HitPay refund（留 POS-04 / POS-03 后续批次）
- 自动对账报表与复杂异常补偿
- 多通道 fallback（Batch 1 仅 HitPay 主通道）

## 4. 验收标准（Batch 1）

- `pending_payment` POS 单可发起 HitPay 并进入 checkout
- HitPay webhook 成功后，POS 单与支付单均为 `paid`
- 重放同一 webhook 事件不重复入账、不重复审计
- 签名失败 webhook 返回 `401 invalid_signature`
- `npm run test:pos03-db` 与 `npx tsc --noEmit` 通过

## 5. Batch 2（运营兜底能力）

- POS 明细页 payment records 增加 `Sync HitPay` 手动同步按钮（复用 `POST /api/payment/hitpay/sync`）
- 新增 webhook 失败落库与看板：
  - `invalid_signature`
  - `provider_event_claim_failed`
  - `complete_pos_hitpay_sale_failed`
- Payments 页面新增 `HitPay webhook exceptions (24h)` 看板（统计 + 最近失败事件）
- 新增前台/运营可直接使用的 SOP 页面：
  - `/dashboard/payments/runbook`

## 6. 2026-08-17 远端 Migration 与恢复加固

- Studio 远端已应用 `20260817120000_pos03_hitpay_recovery_hardening.sql`，并与本地 migration history 对齐。
- 异常记录表已启用 RLS，仅允许 service role 读写；主动同步与 webhook 使用同一 POS 完成事务保存网关证据，已付重放不得覆盖既有事实。
- 本地验证已通过：`test:pos03-db`、`test:pos03-app`、`test:hitpay-merchant-mode`、`npx tsc --noEmit`、定向 ESLint。

## 7. 本地浏览器 UAT（HitPay Sandbox）

- 专用 flow：`pos03-hitpay-sandbox-local`（`uat.flows.json`）。
- 首选执行：GitHub Actions **Free cloud UAT**，选择 `pos03-hitpay-sandbox-local`（runner 自带 Docker 并启动本地 Supabase；使用 `POS03_HITPAY_*` + `HITPAY_API_BASE_URL=https://api.sandbox.hit-pay.com`）。
- 覆盖：创建 HitPay payment request、pending 主动同步、签名 webhook 完成 paid、重放幂等（sale/payment 仍 paid 且 receipt 不变）、无效签名 `401`、已付后再 sync 保持 paid。
- 不使用 Production HitPay，也不在 Production 造支付测试数据。

## 8. 收口证据（2026-08-17）

- Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32004577210
- 日志标记：`pos03_local_uat_ok`；HitPay API base：`https://api.sandbox.hit-pay.com`
- Batch 1/2 专用 Sandbox 浏览器 UAT 已收口；不升“已上线”（待发布窗口）。

# POS-03：HitPay 在线支付闭环（Batch 1 + Batch 2）

状态：已实现/待目标环境验证（Batch 1/2 已落地）

负责人：Codex

开始日期：2026-08-13

Commit / Release：`8c402c3`、`1c0704f`；未上线

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

# POS-04：退款 / 作废 / 日结（Batch 1）

状态：进行中（Batch 1 规划完成，开发待开工）

负责人：Codex

开始日期：2026-08-13

## 1. 目标

先落地 POS-04 的最小可上线闭环（不阻塞现有 POS-01/02/03）：

- 对未付款 POS 单提供受控 `void` 能力（只允许 `draft` / `pending_payment`）
- 对已付款 POS 单提供最小退款入口（先整单退款，后续扩展到明细/部分退款）
- 所有退款/作废动作进入强审计与幂等栅栏
- 给前台/运营明确 SOP，避免“手工改状态”

## 2. 本批范围（Batch 1）

- 数据库：`void_pos_sale` 事务 RPC（含状态机约束、门店隔离、审计）
- 应用层：Dashboard POS 明细页 `Void sale` 入口（仅未付款可见）
- 退款最小入口：复用现有 payment refund 流程，串联 POS sale 状态回写（先整单）
- 可观测：记录 `void_pos_sale_failed` / `refund_pos_sale_failed` 异常事件
- 文档：1 页运行手册（“应收未收取消单 / 已收款退款”）

## 3. 本批不做

- 明细/部分退款金额分摊（后续 Batch）
- Package 反向 Ledger 与 Commission 反向 Entry（依赖 PKG-01 / COM-01）
- Cash Session / 日结总账页面（后续 Batch）
- Credit Note 正式编号策略（后续 Batch）

## 4. 验收标准（Batch 1）

- 仅 `draft` / `pending_payment` POS 单可作废，`paid` 单作废被拒绝
- 作废成功后，相关支付记录与销售状态保持一致，不出现“孤儿状态”
- 退款触发后，POS sale 与 payment 状态一致推进到 `refunded` 或 `partially_refunded`
- 同 idempotency key 重放不重复执行
- `npx tsc --noEmit` 与相关 DB 脚本通过

## 5. 开发顺序（建议）

1. 先做 `void_pos_sale`（风险低、依赖少）
2. 再接 POS 明细页 `Void sale` 按钮
3. 再做整单退款串联与回写
4. 最后补异常看板与 runbook

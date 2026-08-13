# POS-01 发布清单（2026-08-13）

状态：可发布（建议标记 `已验证/待上线`）

适用范围：POS-01 第1~8批（Sale/Item 事实层、去收款主路径、支付读模型回写、验收收口）

## 1. 变更摘要（Release Note）

- 新增 POS 销售事实层：`pos_sales`、`pos_sale_items`（约束、索引、RLS、写入 RPC、硬校验）。
- 去收款主路径打通：从“锁单后跳支付页”升级为“锁单后创建/关联 payment 并进入该 payment”。
- 建立 `pos_sale -> payment` 关联：`payments.pos_sale_id` + 唯一索引，确保同一 sale 不重复创建 payment。
- 支付来源扩展：`payments.source` 支持 `pos_sale`。
- 读模型补齐：POS 列表/详情显示支付进度；明细页新增支付记录入口与“状态来源说明”。
- 验证资产补齐：`test:pos01-db` + `test:pos01-e2e` 可重跑脚本。

## 2. 本次数据库变更

发布必须包含以下 migration（按时间顺序）：

1. `supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql`
2. `supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql`
3. `supabase/migrations/20260813023000_pos01_lock_hard_validation.sql`
4. `supabase/migrations/20260813033000_pos01_payment_link_and_source.sql`

关键发布点：

- `payments.pos_sale_id` 为新增列，且唯一索引 `uq_payments_pos_sale_id` 生效。
- `payments_source_check` 已包含 `pos_sale`。

## 3. 发布前检查（必须全绿）

在待发布分支执行：

- `npx tsc --noEmit`
- `npm run -s test:pos01-db`
- `npm run -s test:pos01-e2e`

建议补跑（非阻断）：

- `npx eslint src/lib/pos-sales.ts src/lib/pos-sales-read.ts src/app/(app)/dashboard/_actions/pos-sales.ts src/app/(app)/dashboard/pos/page.tsx src/app/(app)/dashboard/pos/[saleId]/page.tsx src/app/(app)/dashboard/payments/page.tsx src/components/dashboard/PosProceedToPaymentForm.tsx src/lib/payment-filter-options.ts src/lib/payment-classification.ts src/lib/pos-error-message.ts`

## 4. 发布步骤（应用 + 数据库）

1. 合并发布分支。
2. 按既有生产流程执行 migration（确保上述 4 个文件全部到位）。
3. 部署应用代码（包含 `proceedPosSaleToPaymentAction` 与 POS 列表/详情读模型改造）。
4. 部署后立即执行“发布后核验”。

## 5. 发布后核验（Smoke）

最小业务链路：

1. 在 `/dashboard/pos` 创建或打开 Draft Sale。
2. 加入至少 1 条 Item，点击 “Proceed to payment”。
3. 断言 Sale 状态进入 `pending_payment`。
4. 跳转到 `/dashboard/payments` 时能定位到同一 payment（`payment_id` 命中）。
5. 重复点击“去收款”不新增第二条 payment（同 `pos_sale_id` 仅一条）。
6. POS 列表显示 Payment progress；POS 详情可打开支付记录。

数据核对：

- `payments.pos_sale_id = pos_sales.id`
- 同一 `pos_sale_id` 在 `payments` 只出现 1 条记录
- `payments.source = 'pos_sale'`

## 6. 回滚点与处置策略

本批 migration 为“前向扩展（additive）”，推荐**应用层回滚优先**：

### 回滚点 A（首选）：应用回滚

- 回退到上一个稳定应用版本。
- 数据库保留新增列/索引/RPC（不做破坏性回退）。
- 影响：新增 POS 收款入口不可见，但既有支付/订单数据不丢失。

### 回滚点 B：功能降级（不回滚库）

- 暂停前台“去收款主路径”入口（恢复旧跳转逻辑或临时隐藏入口）。
- 保留 `payments.pos_sale_id` 数据，待修复后继续复用。

### 回滚点 C（仅事故处置，不推荐常态）

- 若必须紧急止血：先应用回滚，再阻断新 `pos_sale` payment 创建路径。
- 不建议在生产直接 drop 新列/索引/约束，避免二次故障。

## 7. 已知风险与监控

- 报表口径：当前 `source='pos_sale'` 在分类函数映射到 `service` 桶；后续若新增 POS 专属桶需同步报表。
- 支付闭环：`pending_payment -> paid/refunded` 的自动回写仍依赖 POS-02/POS-03 事务链路。

建议监控：

- 24 小时内 `payments` 中 `source='pos_sale'` 的创建量与失败量。
- `payments` 唯一索引冲突告警（`uq_payments_pos_sale_id`）。
- POS 列表 `pending_payment` 长时间停留比例。

## 8. 证据留档

本次发布建议留档以下命令输出：

- `npm run -s test:pos01-db`
- `npm run -s test:pos01-e2e`
- `npx tsc --noEmit`

并在 `docs/salon-psg/tasks/POS-01.md` 的“验证结果”保持同步。

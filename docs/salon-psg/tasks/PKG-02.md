# PKG-02：套餐调整审批与部分退款回冲

状态：已实现/待目标环境验证

Commit / Release：`f18bb4c`、`02d4aee`、`9283eb6`、`30f652c`、`bf80d06`、`cf3291f`、`09f9fb1`；未上线

## 1. 背景与目标

`PKG-01` 已完成最小闭环：Paid 发放 `purchase_grant`，退款时写入 `refund_reversal`。

本任务启动时的已知缺口是：`package` 退款仅支持“整行全退后一次性回冲”，不支持部分退款按比例回冲；该缺口现已由本任务 Migration 与验证脚本关闭。

在现有实现中，`public.pkg01_apply_sale_package_refund_reversals(...)` 有以下硬限制（见 `supabase/migrations/20260814002000_pkg01_pos_package_grant_refund_linkage.sql`）：

- `refund_qty` 必须等于 `item.quantity`，否则抛错 `partial package refund is not supported...`
- 要求 `refunded_quantity = quantity` 才允许回冲
- 每个 `sale_item` 仅允许一条 `refund_reversal`（通过 `(studio_id, source_type, source_id, event_type, client_package_id)` 唯一约束）

`PKG-02` 在“准备段”的目标是：在不破坏现有 Ledger/Audit/Idempotency 契约下，支持 package item 的**多次部分退款按比例逐步回冲**。

## 2. 范围与非目标

### 2.1 范围

- 支持同一 package sale item 多次退款（例如 `2` 套中的 `1` 套，再退剩余 `1` 套）。
- 每次退款后，按累计退款比例计算“应回冲总 credits/value”，并按差额写入增量 `refund_reversal`。
- 保持 append-only；不更新历史 Ledger 行。

### 2.2 非目标（本批不做）

- 不改动 PKG-02 maker-checker 审批主流程（该流程独立交付）。
- 不在本批解决 `salon_customer.user_id is null` 的发放策略（单列 Step 4）。

## 3. 设计原则

1. **累计目标、增量落账**：
   - 计算“到当前退款状态为止，应回冲总量（target）”。
   - 与“已回冲总量（already reversed）”比较，仅写入差额（delta）。

2. **天然幂等**：
   - 同一“退款检查点”只能插入一次。
   - 重放同一事件时，delta=0，直接跳过。

3. **金额和 credits 都可追溯**：
   - `delta_credits` 按比例差额。
   - `value_delta_amount` 同步按比例差额，确保 deferred value 口径一致。

## 4. 数据与唯一键策略

## 4.1 为什么不能继续用 `source_id = sale_item_id`

当前唯一索引：

```sql
uq_client_package_ledger_source_event
(studio_id, source_type, source_id, event_type, client_package_id)
```

若 `source_id` 固定为 `sale_item_id`，同一 item 无法写入第二条 `refund_reversal`。

### 4.2 新策略：检查点 source_id

新增 `source_type = 'pos_sale_item_refund_checkpoint'`，`source_id` 改为“检查点 UUID”（由 `sale_item_id + refunded_quantity + refunded_amount` 生成的确定性 UUID）。

这样可同时满足：

- 同一检查点重放时不重复写入（唯一键拦截）。
- 同一 item 在不同退款阶段可写入多条增量 reversal。

## 5. 核心算法（部分退款按比例回冲）

对每个 package item：

- 输入：
  - `item.quantity`
  - `item.refunded_quantity`（累计）
  - `item.total_amount`
  - `item.refunded_amount`（累计）
  - grant 行：`grant.delta_credits`、`grant.value_delta_amount`

- 计算：
  - `grant_credits = abs(grant.delta_credits)`
  - `grant_value = abs(grant.value_delta_amount)`
  - `target_credits = floor(grant_credits * refunded_quantity / quantity)`
    - 若 `refunded_quantity >= quantity`，强制 `target_credits = grant_credits`
  - `target_value = round(grant_value * refunded_amount / total_amount, 2)`
    - 若 `refunded_amount >= total_amount`，强制 `target_value = grant_value`

- 已回冲累计：
  - `already_credits = sum(abs(delta_credits))`（同 item + client_package 的所有 `refund_reversal`）
  - `already_value = sum(abs(value_delta_amount))`

- 增量：
  - `delta_credits = target_credits - already_credits`
  - `delta_value = target_value - already_value`
  - 若两者都 `<= 0`，跳过。

- 落账：
  - 写入 `refund_reversal`，`delta_credits = -delta_credits`，`value_delta_amount = -delta_value`
  - `source_type = 'pos_sale_item_refund_checkpoint'`
  - `source_id = checkpoint_uuid`

## 6. 代码改动点（建议）

1. 修改 `public.pkg01_apply_sale_package_refund_reversals(...)`：
   - 去掉“必须全退”校验。
   - 改为“累计目标 - 已回冲”增量写入。
   - 支持新 `source_type` 和检查点 `source_id`。

2. 修改 `public.pkg01_on_pos_sale_refunded_apply_reversals()` 触发器：
   - 目前只挑 `refunded_quantity = quantity` 的 item。
   - 改为挑 `refunded_quantity > 0` 且“尚有可回冲增量”的 item。

3. （推荐）在 `public.refund_pos_sale_items(...)` 内部显式调用回冲函数：
   - 与 POS-04 退款更新置于同一事务。
   - 复用 POS-04 的 idempotency key 作为关联字段。

## 7. 兼容与迁移

### 7.1 向后兼容

- 已存在的全额回冲行（`source_type = 'pos_sale_item_refund'`）继续有效。
- 新逻辑累计 `already_credits/already_value` 时，应同时统计旧/新两种 `source_type`，避免重复回冲。

### 7.2 迁移脚本要点

- 不需要改历史数据。
- 仅上线新函数与触发器逻辑。
- 若需要补跑，执行一次“按 sale 扫描并回冲增量”的 repair job。

## 8. 验收场景（最少）

1. `quantity=2`，首次退 `1`：新增一条 reversal，回冲约一半 credits/value。
2. 再退剩余 `1`：新增第二条 reversal，累计回冲等于整单 grant。
3. 同一请求重放：不新增行（幂等）。
4. 已有旧全额 reversal 的历史单据：新逻辑不重复回冲。
5. credits 不足：保持失败并回滚，不得写入半条 Ledger。

## 9. 风险与控制

- **四舍五入误差**：使用“累计目标 + 增量差额”而非“每次按本次退款比例直接算”，避免误差累积。
- **并发退款**：沿用 POS-04 行级锁与 idempotency fencing；回冲函数内部继续 `FOR UPDATE` 锁定相关 `pos_sale_items`、`client_packages`。
- **运营可解释性**：在 `metadata` 记录 `target/already/delta` 三组值，支持审计追溯。

## 10. 建议上线顺序

1. 先在 staging 对“多次部分退款”跑脚本验证。
2. 再灰度到生产（仅一个 studio）。
3. 观察 3 天：冲突数、退款失败率、deferred 汇总波动。
4. 全量开启。

## 11. Guest 身份策略（已落地草案）

- 背景：`pkg01_apply_sale_package_grants` 之前在 `salon_customer.user_id is null` 时直接抛错，会卡住前台 package 发放。
- 策略：改为“**不阻塞收款，延迟发放**”。
  - Paid 时若 `user_id is null`，将 package item 写入 `pkg02_guest_package_grant_queue`（`pending`）。
  - 当 `salon_customers.user_id` 后续被链接（Guest 注册/绑定）时，由触发器自动处理队列并补发 `purchase_grant`。
- 保障：
  - 队列按 `(studio_id, pos_sale_item_id)` 去重，避免重复排队。
  - 处理器补发前仍复用原 `pkg01_apply_sale_package_grants` 幂等判断（`pos_sale_item_grant` 唯一来源）。
  - 成功补发后队列标记 `resolved`，失败保留 `last_error` 便于运营处理。

## 12. Deferred Drill-down（已落地）

- 入口：`/dashboard/reports` 的 Deferred Value 卡片新增两条 drill-down 快捷入口：
  - `Customer details`
  - `Package details`
- 明细区：新增 `Deferred drill-down` 卡片，支持：
  - 客户维度 / 套餐维度切换
  - 关键字筛选（客户、套餐、邮箱）
  - 客户与套餐双条件筛选
  - 同页反向 drill（客户行跳套餐明细、套餐行跳客户明细）
- 导出：新增 CSV / TSV / XLSX / XML 导出接口，沿用页面相同筛选条件：
  - `GET /api/reports/deferred/export`
  - 入参：`studio_id`、`location_id`、`deferred_view`、`deferred_customer_id`、`deferred_package_id`、`deferred_q`、`format(csv|tsv|xlsx|xml)`
  - 套餐视图导出新增 `location_name`（同时保留 `location_id` 供 BI 关联）
  - 导出上限保护：`XLSX/XML` 上限 `2000` source rows（CSV/TSV 为 `5000`）；超限时响应头返回 `x-export-capped=true` 与 `x-export-warning`

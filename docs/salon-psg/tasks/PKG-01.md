# PKG-01：Package Ledger（opening balance + 事件账本）

状态：已验证/待上线（专用 Free cloud UAT 已通过）

负责人：待分配

开始日期：2026-08-14

完成日期：2026-08-17

Commit / Release：`52ff41a`、`92b2efe`、`e045136`、`f11a42d`、`f2a6f4a`；未上线

## 1. 目标

在不破坏现有 Class Pass、公开购买与历史余额行为的前提下，将 `client_packages.credits_left` 升级为“余额缓存 + 不可篡改 Ledger”的双轨模型：所有余额变化必须有可追溯 Ledger 事实，并复用 POS-01 销售事实与 FND-04 强审计/幂等契约。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/08-packages.md`
- `docs/salon-psg/10-development-backlog.md`（PKG-01）
- `docs/salon-psg/16-complete-implementation-plan.md`（PKG-01）
- `docs/salon-psg/15-implementation-status.md`（2026-08-12 依赖契约冻结）
- `docs/salon-psg/tasks/FND-04.md`
- `docs/salon-psg/tasks/POS-01.md`
- `src/lib/idempotency.ts`
- `src/lib/strong-audit.ts`
- `node_modules/next/dist/docs/` 中本任务实际改动涉及的 Next.js 16 文档

## 3. 依赖与输入契约

- 已完成依赖：`FND-02`、`FND-03`、`FND-04`、`POS-01`
- 复用的数据身份：Studio / Location / Salon Customer / Package / POS Sale / Payment
- 契约冻结（2026-08-12）：
  - PKG-01 只能复用 FND-04 `business_idempotency_keys` + `strong_audit_logs`
  - PKG-01 只能复用 POS-01 销售事实，不新增平行销售真相源
  - 禁止新增第二套账本幂等/审计模型
- 仍需产品或外部确认：
  - 退款回冲时“未使用价值”口径与财务报表口径是否完全一致
  - 无法映射 `salon_customers` 的历史 `client_packages` 最终处置流程

## 4. Scope Freeze（本任务写死）

### 4.1 Opening balance 规则（写死）

- 每条仍有效或仍有余额的历史 `client_packages`，迁移为 1 条 `opening_balance` Ledger。
- opening balance 为“基线事实”，只允许迁移脚本写入，不允许业务接口二次写入。
- opening balance 必须携带来源定位（至少含 legacy `client_packages.id`），用于差异对账。
- 无法映射到 `salon_customers` 的记录不得静默跳过：必须进入冲突报告并可复跑。

### 4.2 Ledger 事件类型（写死）

`client_package_ledger_entries.event_type` 固定为以下枚举，后续任务不得随意改名：

- `opening_balance`：历史余额迁移基线。
- `purchase_grant`：已支付套餐销售发放权益（来自 POS-01 + payment 已确认）。
- `consume`：预约/履约核销权益。
- `cancel_return`：按规则取消后返还权益。
- `refund_reversal`：退款触发反向回冲权益。
- `expiry`：到期自动失效。
- `manual_adjustment`：预留给 PKG-02 审批通过后的正式调整（PKG-01 不开放入口）。

### 4.3 幂等与审计复用（写死）

- 所有“会改变余额”的路径必须走 FND-04 Claim/Complete/Fail fencing。
- Ledger 写入与 `client_packages.credits_left` 更新必须同事务提交，失败一起回滚。
- 强审计统一走 `record_strong_audit`，记录 actor、scope、target 与关键前后值。
- 退款/支付回调类重放必须复用 provider event dedup，不允许重复发放或重复回冲。

## 5. 本任务必须完成

- 数据库基座（先于 UI）：
  - 新增 `client_package_ledger_entries`（或同等命名）主表
  - 完整约束：Studio/Location/Customer 一致性、余额非负、防重复 source
  - 完整索引：`(studio_id, customer_id, package_id, created_at)`、来源去重索引
  - 审计字段：`created_at`、`created_by`、`audit_log_id`、`idempotency_key_id`
- 迁移与回填：
  - opening balance 迁移脚本 + 冲突报告 + 可重跑策略
- POS 联动最小闭环（不扩 UI）：
  - 购买发放：仅 `paid` 的 package sale 产生 `purchase_grant`
  - 退款回冲：仅已发放权益的 sale 按规则产生 `refund_reversal`
- 验证脚本：
  - 先提供可重复 SQL 验证（风格对齐 POS-04）
  - 再允许接入页面展示

## 6. 明确不做

- 不做 PKG-02 的 Maker-Checker 审批流与人工调整入口
- 不做复杂 Package 管理 UI（筛选、图表、批量操作）
- 不做 Payroll/Commission 结算逻辑（COM-01）
- 不做 POS-04 全量退款编排改造，仅覆盖 PKG-01 所需“回冲事实写入”
- 不修改任何既有已应用历史 Migration

## 7. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 查看客户 Package Ledger | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ✅（仅本人） | ❌ |
| 创建 `purchase_grant` / `refund_reversal` | ✅ | ✅ | ✅（服务端受控） | ❌（不直写） | ❌ | ❌ | ❌ |
| 写 `opening_balance` | ❌（仅 migration） | ❌（仅 migration） | ❌ | ❌ | ❌ | ❌ | ❌ |
| 写 `manual_adjustment` | ❌（PKG-02） | ❌（PKG-02） | ❌ | ❌ | ❌ | ❌ | ❌ |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

## 8. Migration 和回填

- Migration 文件：必须由 Supabase CLI 生成（PKG-01）
- 现有数据策略：先建 Ledger 与约束，再执行 opening balance 回填
- 冲突/异常报告：输出“无法映射 Customer / 负余额 / 重复来源”明细
- 可重跑策略：同来源唯一键 + FND-04 幂等，重复执行不重复记账
- 回滚或上线风险：历史数据质量导致 opening balance 差异，需要上线前对账签字

## 9. 验收场景（Phase 2 主路径）

- [ ] opening balance 迁移后，`credits_left == Ledger 汇总余额`
- [ ] 旧 Class Booking 不回退，既有 consume/return 语义保持
- [x] 仅 paid package sale 发放 `purchase_grant`
- [ ] 同一来源重复触发不重复发放（幂等）
- [x] 退款仅回冲已发放且未被同源回冲的权益
- [ ] Studio 隔离与 Location Scope 允许/拒绝
- [ ] 角色允许/拒绝（含 Customer 仅可读本人）
- [ ] 数据库约束拒绝非法组合（跨 Studio、负余额、未知来源）
- [ ] SQL 验证脚本可重复执行并稳定通过（对齐 POS-04 风格）
- [ ] Migration 在空库、现有数据及二次执行通过
- [ ] `npx tsc --noEmit`
- [ ] 相关 ESLint/测试
- [ ] anon/authenticated/service_role 表与 RPC 权限矩阵

## 10. 建议开发顺序（从本文件冻结后）

1. 先落 DB 基座 migration（表/约束/索引/审计字段）
2. 再落 opening balance 回填与冲突报告
3. 再接 POS 最小闭环（购买发放/退款回冲）
4. 最后补 SQL 验证脚本与发布前回归

## 11. 实际交付

### 修改文件

- `docs/salon-psg/tasks/PKG-01.md`
- `supabase/migrations/20260814001000_pkg01_package_ledger_foundation.sql`
- `supabase/migrations/20260814002000_pkg01_pos_package_grant_refund_linkage.sql`
- `supabase/migrations/20260814003000_pkg01_opening_balance_backfill.sql`
- `supabase/migrations/20260814004000_pkg01_deferred_value_view_rpc.sql`
- `supabase/migrations/20260814005000_pkg01_deferred_value_summary_rpc.sql`
- `scripts/sql/pkg01_verify_patch_schema.sql`
- `scripts/sql/verify_pkg01_pos_minimal.sql`
- `scripts/sql/verify_pkg01_opening_balance.sql`
- `scripts/sql/verify_pkg01_deferred_value.sql`
- `scripts/verify-pkg01-db.sh`
- `package.json`

### 数据库变化

- 新增 `client_package_ledger_entries`（append-only）及事件枚举、来源去重索引、审计/幂等引用字段。
- 新增 Ledger 强一致性校验触发器：Studio/Location/Customer/Package/POS/Payment/Audit/Idempotency 关联必须合法。
- 新增 POS 联动 helper：
  - `pkg01_apply_sale_package_grants`
  - `pkg01_apply_sale_package_refund_reversals`
- 新增 opening balance 回填能力：
  - `pkg01_opening_balance_conflicts`（冲突报告表，可重跑去重）
  - `backfill_pkg01_opening_balance`（支持 `dry_run` / `limit` / studio 定向）
- 新增 deferred value 计算能力：
  - `pkg01_deferred_value_candidates(...)`（内部候选函数，含冲突判定）
  - `pkg01_deferred_value_rows`（对外视图，仅输出可计提行）
  - `get_pkg01_deferred_value(...)`（可按 studio/customer/package/as_of 查询，并可刷新冲突）
  - `get_pkg01_deferred_value_summary(...)`（按 studio/location/currency 汇总，面向报表）
  - `pkg01_deferred_value_conflicts`（单价快照/客户映射冲突报告表）
- 新增 POS 触发器闭环：
  - `pos_sales.status -> paid` 自动发放 `purchase_grant`
  - `pos_sales.refunded_amount/status` 变化时对已全额退款 package item 自动写 `refund_reversal`

### Deferred Value 口径定义（Batch 4）

- 主公式：`deferred_value = remaining_credits * unit_price_snapshot`。
- `remaining_credits`：以 `client_packages.credits_left` 为准（实时余额缓存）；`as_of` 传过去时可按 Ledger 最近快照回看（仅对已 Ledger 化事件有效）。
- `unit_price_snapshot` 优先级：
  1) `purchase_grant` 的 `value_delta_amount / delta_credits`；
  2) 回退：`packages.price / client_packages.package_credits_snapshot`；
  3) 再回退：`packages.price / packages.credits`。
- 币种：优先 `purchase_grant.currency`，再回退任意最早 Ledger 币种，最后默认 `SGD`。

### Deferred Value 边界案例（Batch 4）

- `credits_left <= 0`：不输出 deferred row（不重复计提）。
- 无法唯一映射 `salon_customer`：记冲突（`missing_salon_customer` / `multiple_salon_customers`），不输出。
- 单价快照缺失或非法：记冲突（`missing_unit_price_snapshot` / `invalid_unit_price_snapshot`），不输出。
- 冲突可重跑刷新：`get_pkg01_deferred_value(..., p_refresh_conflicts := true)` 会自动补写新冲突并将已修复项标记 `resolved`。

### 验证结果

- `bash scripts/verify-pkg01-db.sh`：通过（`verify_pkg01_pos_minimal: ok`）。
- `bash scripts/verify-pkg01-db.sh`：通过（`verify_pkg01_pos_minimal: ok` + `verify_pkg01_opening_balance: ok`）。
- `bash scripts/verify-pkg01-db.sh`：通过（新增 `verify_pkg01_deferred_value: ok`）。
- 验证覆盖：
  - paid package sale 自动生成 `purchase_grant` 与 `client_packages` 余额。
  - 全额 item refund 自动生成 `refund_reversal` 与余额回冲。
  - opening balance dry-run 不落库；正式执行落 1 条 opening entry；二次执行不重复入账。
  - 无法映射 `salon_customer` 的历史 `client_packages` 会写冲突报告。
  - deferred value 对 purchase snapshot 与 fallback snapshot 口径计算正确。
  - deferred value summary 对总未消费 credits 与总 deferred value 聚合正确。
  - deferred value 冲突可写入并在数据修复后自动转为 `resolved`。
  - Ledger append-only 保护在校验链路中保持有效。

### 本地浏览器 UAT

- 专用 flow：`pkg01-package-ledger-local`（`uat.flows.json`）。
- 首选执行：GitHub Actions **Free cloud UAT**，选择 `pkg01-package-ledger-local`。
- 覆盖：390px 现金班次开启、package 现金收款、`purchase_grant` 与客户 ledger 可见 credits、整项退款 `refund_reversal`、Instructor POS 拒绝访问。
- 不把部分 package refund 或 Guest `user_id is null` 发放作为本项通过条件。
- Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32027455067（`pkg01_local_uat_ok`）。

### 未解决风险

- 当前 Batch 2 对 package item 退款采用最小闭环：仅支持“整项全额退款”自动回冲；部分 package refund 留待后续批次。
- 对 `salon_customer.user_id is null`（纯 Guest）的 POS package sale，当前会拒绝发放（需后续身份策略确认）。

没有实际命令输出或测试证据时，不勾选对应项目。

## 12. 后续任务接口

- PKG-02 可依赖：
  - append-only `client_package_ledger_entries` 与来源唯一性约束
  - opening balance 已入账且可对账
  - purchase/refund 两条最小事实链路稳定
- 禁止假设：
  - 不假设所有余额都来自新链路（兼容期仍有历史来源）
  - 不假设 `manual_adjustment` 在 PKG-01 已开放
  - 不假设 deferred value 等于会计确认收入

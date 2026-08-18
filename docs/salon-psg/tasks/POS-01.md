# POS-01：销售主单与购物车统一事实

状态：已上线（`61dbdf0`，gate `32086736757`）

负责人：Codex

开始日期：2026-08-12

完成日期：2026-08-13

Commit / Release：`61dbdf0`（gate `32086736757`）

## 1. 目标

建立统一 `pos_sales` 与 `pos_sale_items` 销售事实层，支持 Service / Product / Package 共用交易主单、价格快照、折扣分摊、权限校验与强审计/幂等，作为 POS-02、POS-03、PKG-01 的唯一上游销售来源。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/05-pos.md`
- `docs/salon-psg/08-packages.md`
- `docs/salon-psg/10-development-backlog.md`（POS-01）
- `docs/salon-psg/16-complete-implementation-plan.md`（POS-01）
- `docs/salon-psg/17-pos-idempotency-request-hash.md`
- `docs/salon-psg/tasks/FND-04.md`
- `docs/salon-psg/tasks/APT-05.md`
- `src/lib/idempotency.ts`
- `src/lib/strong-audit.ts`
- `node_modules/next/dist/docs/` 中 Server Actions / Route Handlers / Caching 相关文档

## 3. 依赖与输入契约

- 已完成依赖：`FND-01`、`FND-02`、`FND-03`、`FND-04`
- 复用的数据身份：Studio / Location / Customer / Employee / Service / Product / Package
- 幂等与审计契约：必须复用 FND-04 `business_idempotency_keys` 与 `strong_audit_logs`，不得新增第二套并行模型
- 仍需产品或外部确认：
  - 混合购物车折扣分摊规则（按金额/按类别/固定优先级）
  - Service Item 无预约场景的履约凭证字段最小集
  - POS 主单与现有 `/api/package/buy` 兼容切换节奏

## 4. 本任务必须完成

- 数据库：新增 `pos_sales`、`pos_sale_items` 及必要索引、约束、RLS、RPC
- 主单能力：草稿、加项、改项、提交（收款前自动锁单），禁止已提交单被覆盖编辑
- 快照能力：保存项目名称、单价、币种、数量、折扣、税额与归属快照
- 一致性：同事务校验 Studio/Location/Customer/Employee/Item 归属合法
- 幂等/审计：主写路径全部接入 Claim/Complete/Fail 与强审计
- 兼容层：保留现有 package 在线购买入口，对内逐步映射到 POS Sale 事实

## 5. 明确不做

- 不实现现金收款、找零与正式收据（POS-02）
- 不实现 HitPay 支付请求、Webhook 与支付同步（POS-03）
- 不实现 Package Ledger 发放/扣减与 opening balance 迁移（PKG-01）
- 不实现佣金结算（COM-01）
- 不修改任何既有已应用 Migration

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 查看 POS Sale | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 新建/编辑草稿 Sale | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 提交 Sale（收款前自动锁单） | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 读取 item 快照报表字段 | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

前台交互约定：不暴露“手工锁单”入口；统一通过“去收款”触发服务端自动锁单与提交前硬校验。

## 7. Migration 和回填

- Migration 文件：待 Supabase CLI 生成（POS-01）
- 现有数据策略：先新增事实层，不立即回填历史订单
- 冲突/异常报告：冲突项写入审计与错误摘要，禁止静默覆盖
- 可重跑策略：主写 RPC 幂等，重复提交不重复创建 Sale/Item
- 回滚或上线风险：旧入口与新事实双写期间的数据一致性风险

## 8. 验收场景

- [x] 正常创建 Sale + 多 Item 保存
- [x] Studio 隔离
- [x] Location Scope 允许/拒绝
- [x] 角色允许/拒绝
- [x] Item 归属约束拒绝非法组合
- [x] 幂等重放不重复创建 Sale/Item
- [x] Migration 在空库、现有数据及二次执行通过
- [x] `npx tsc --noEmit`
- [x] 相关 ESLint/测试
- [x] anon/authenticated/service_role 表与 RPC 权限矩阵

## 9. 实际交付

### 修改文件

- `docs/salon-psg/tasks/POS-01.md`
- `docs/salon-psg/releases/2026-08-13-pos01-release-checklist.md`
- `supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql`
- `supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql`
- `supabase/migrations/20260813023000_pos01_lock_hard_validation.sql`
- `supabase/migrations/20260813033000_pos01_payment_link_and_source.sql`
- `src/lib/pos-idempotency.ts`
- `src/lib/pos-sales.ts`
- `src/lib/pos-sales-read.ts`
- `src/lib/pos-error-message.ts`
- `src/lib/payment-filter-options.ts`
- `src/lib/payment-classification.ts`
- `src/components/dashboard/PosProceedToPaymentForm.tsx`
- `src/app/(app)/dashboard/_actions/pos-sales.ts`
- `src/app/(app)/dashboard/actions.ts`
- `src/app/(app)/dashboard/pos/page.tsx`
- `src/app/(app)/dashboard/pos/[saleId]/page.tsx`
- `src/app/(app)/dashboard/payments/page.tsx`
- `scripts/verify-pos01-db.sh`
- `scripts/verify-pos01-e2e.sh`
- `scripts/sql/verify_pos01_sale_fact_skeleton.sql`
- `scripts/sql/verify_pos01_write_rpcs_v2.sql`
- `scripts/sql/verify_pos01_write_rpcs_v3.sql`
- `scripts/sql/pos01_e2e_payments_stub.sql`
- `scripts/sql/verify_pos01_e2e_proceed_to_payment.sql`
- `package.json`

### 数据库变化

- 新增 `pos_sales` / `pos_sale_items` 事实层与约束、索引、触发器。
- 新增 POS-01 写入 RPC：`create_pos_sale_draft`、`upsert_pos_sale_item`、`lock_pos_sale`。
- 写入路径接入 FND-04 Claim/Complete/Fail 幂等栅栏与强审计。
- `lock_pos_sale` 增加提交前硬校验（空单、快照缺失、币种/金额不一致拒绝）。
- 新增 `payments.pos_sale_id` 关联、唯一索引与 `source='pos_sale'` 约束扩展。

### 验证结果

- `npm run -s test:pos01-db`：通过（包含 skeleton + write-rpc + lock-hard-validation 验证）。
- `npm run -s test:pos01-e2e`：通过（创建草稿 → 加项 → 去收款锁单 → 幂等 payment ensure → 状态改为 paid）。
- `npx tsc --noEmit`：通过。
- `npx eslint src/lib/pos-sales.ts src/lib/pos-sales-read.ts src/app/(app)/dashboard/_actions/pos-sales.ts src/app/(app)/dashboard/pos/page.tsx src/app/(app)/dashboard/pos/[saleId]/page.tsx src/app/(app)/dashboard/payments/page.tsx src/components/dashboard/PosProceedToPaymentForm.tsx src/lib/payment-filter-options.ts src/lib/payment-classification.ts src/lib/pos-error-message.ts`：通过。

### 未解决风险

- 目前 `pos_sale` 来源在报表分类临时映射到 `service` 桶，后续若新增专属 POS 桶需同步报表口径。
- 支付“创建并关联”当前在应用层 `ensure`，后续若接入多支付方式（POS-02/03）建议下沉单一事务/RPC。
- `pending_payment -> paid/refunded` 的自动回写依赖后续 POS-02/POS-03 交易闭环，不在 POS-01 范围内。

### 发布清单

- `docs/salon-psg/releases/2026-08-13-pos01-release-checklist.md`

没有实际命令输出或测试证据时，不勾选对应项目。

## 10. 后续任务接口

- 稳定接口（目标）：
  - `pos_sales` 主单读取/提交接口
  - `pos_sale_items` 明细事实读取接口
  - POS-01 统一幂等写入 RPC
- 禁止假设：
  - 不假设 POS Sale = 已支付
  - 不假设 Package 权益在 POS-01 自动发放
  - 不假设佣金在 POS-01 生成

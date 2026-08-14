# COM-01：佣金规则和入账

状态：已实现/待验证（P1/P2 修复已完成）

负责人：Codex

开始日期：2026-08-14

完成日期：2026-08-14

Commit / Release：`9aab9ef`、本次 P1/P2 修复独立 commit（未 push / 未部署）

## 1. 目标

以 `pos_sale_items(item_type='service')` 作为唯一金额来源，建立可追溯、可重放且不可重复的佣金入账链路：

- 仅当“服务已完成 + POS Service Item 已 Paid”同时满足时，产生一条原始 Earned Entry
- Appointment 与 POS 先后顺序任意时，最多只生成同一条原始 Entry
- 退款以新增反向 Entry 处理，不覆盖原 Entry
- 所有关键写入在数据库事务/RPC 内完成，并复用强审计与幂等基础设施

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/07-employees-commission-payroll.md`
- `docs/salon-psg/10-development-backlog.md`
- `docs/salon-psg/15-implementation-status.md`
- `docs/salon-psg/16-complete-implementation-plan.md`
- `docs/salon-psg/tasks/CRM-02.md`
- `docs/salon-psg/tasks/POS-02.md`
- `docs/salon-psg/tasks/POS-03.md`
- `docs/salon-psg/tasks/POS-04.md`
- `docs/salon-psg/releases/2026-08-14-pos-pkg-joint-acceptance.md`

## 3. 依赖与输入契约

- 已完成依赖：POS-02、POS-03、CRM-02（POS-04 已实现/待最终 Gate）
- 复用的数据身份：Studio / Location / Customer / Employee / Service / POS Sale Item / Appointment
- 复用基础设施：`strong_audit_logs`、`business_idempotency_keys`、现有 POS Paid/Refund 事实
- 仍需产品或外部确认：无（若遇到不可安全推断的规则优先阻塞并记录）

## 4. 本任务必须完成

- 数据库：
  - 佣金规则版本表（员工/服务维度）
  - 佣金分录表（earned + refund_reversal，append-only）
  - Walk-in `fulfilled_at` 完成证据（受审计）
  - 唯一来源保护：同一 POS Service Item 最多一条原始 Entry
  - 退款检查点去重：同一退款状态快照只产生一次反向 Entry
  - 约束、索引、RLS、权限、触发器/RPC
- 服务端/数据库逻辑：
  - Paid 与 Completed 任意先后，均可最终入账且不重复
  - Appointment 服务：必须 `appointment.completed + pos item paid`
  - Walk-in 服务：必须 `fulfilled_at + pos item paid`
  - 退款新增反向 Entry，不覆盖原 Entry
  - 金额计算在数据库函数内完成
- 审计/幂等：
  - Walk-in fulfill RPC 走 `business_idempotency_keys`
  - 佣金 earned/reversal 写入 `strong_audit_logs`
- 验证：
  - 独立 PostgreSQL 15 runner 与 COM-01 SQL 验证脚本
  - 覆盖先付后做、先做后付、重复重放、越权拒绝、部分/全额退款

## 5. 明确不做

- PAY-01/02/03（Payroll Run、Payslip、法定规则）
- RPT-01/02 报表开发
- Marketing 模块
- 手工覆盖已入账原始佣金（append-only，不提供直接改写）

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 标记 Walk-in fulfilled（同 studio/location） | 允许 | 允许 | 允许 | 允许 | 拒绝（本任务） | 拒绝 | 拒绝 |
| 触发自动佣金入账（由 DB 事件执行） | 系统 | 系统 | 系统 | 系统 | 系统 | 拒绝 | 拒绝 |
| 读取佣金事实（当前） | service_role | service_role | service_role | service_role | service_role | 拒绝 | 拒绝 |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

## 7. Migration 和回填

- Migration 文件：新增 COM-01 migration（Supabase SQL）
- 现有数据策略：
  - 不在 migration 内自动回填历史佣金，避免在生产写入未经业务确认的财务分录
  - 仅建立可重放的增量入账机制，后续历史补录需单独任务与审批
- 冲突/异常报告：
  - 规则缺失、服务未完成、未付款、越权等返回明确错误/skip 原因
- 可重跑策略：
  - earned 由唯一约束保证幂等
  - refund reversal 由退款检查点唯一键保证幂等
- 回滚或上线风险：
  - 规则未配置会导致该 item 暂不入账（不影响 POS Paid 主流程）

## 8. 验收场景

- [x] 先付款后完成，仅 1 条 earned
- [x] 先完成后付款，仅 1 条 earned
- [x] 重复事件/并发重放不重复入账
- [x] 未付款或未完成不入账
- [x] Appointment 与 POS 不重复
- [x] Walk-in fulfilled_at 证据必需且受审计
- [x] 部分退款和全额退款生成反向 Entry（增量）
- [x] Studio 隔离与跨 Location 越权拒绝
- [x] 不同角色允许/拒绝
- [x] Migration 空库与复跑通过
- [x] `npx tsc --noEmit`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run test:com01-db`

## 9. 实际交付

### 修改文件

- `supabase/migrations/20260814100000_com01_commission_foundation.sql`
- `scripts/sql/verify_com01_commission.sql`
- `scripts/verify-com01-db.sh`
- `scripts/sql/com01_verify_patch_schema.sql`
- `scripts/sql/com01_payments_refund_patch.sql`
- `package.json`
- `docs/salon-psg/tasks/COM-01.md`
- `docs/salon-psg/15-implementation-status.md`

### 数据库变化

- `pos_sale_items` 增加 walk-in 完成证据字段：`fulfilled_at` / `fulfilled_by` / `fulfillment_note`
- 新增规则表：`employee_service_commission_rules`
- 新增分录表：`service_commission_entries`（append-only，earned/reversal）
- 新增 RPC/函数：
  - `com01_mark_pos_service_item_fulfilled`
  - `com01_try_record_earned_for_sale_item`
  - `com01_apply_refund_reversal_for_sale_item`
  - `com01_sync_sale_commissions_from_sale`
  - `com01_resolve_commission_rule`
- 新增触发器（自动同步）：
  - POS sale paid
  - Appointment completed
  - Walk-in fulfilled_at 更新
  - POS item refund 更新
- 新增唯一来源保护：
  - 同一 `pos_sale_item` 最多一条 `earned`
  - 同一退款检查点最多一条 `refund_reversal`

### 验证结果

- `npm run test:com01-db`：通过（`com01_commission_ok`），含 migration 复跑、双连接并发（付款 vs walk-in fulfill）
- `npm run lint`：通过
- `npx tsc --noEmit`：通过
- `npm run build`：通过（Next.js 16.2.4）

### 未解决风险

- 规则缺失策略当前为“跳过入账（rule_not_found）但不阻断 POS Paid 主流程”；上线前需确认是否改为强阻断或补偿队列。
- 本轮未执行生产/目标环境浏览器点击流，仅完成隔离 PostgreSQL 15 runner 与本地门禁。
- 佣金基数当前按 `pos_sale_items.total_amount`（含折扣/税后总额）计算；若业务需改为税前或净额，需在 COM-01.1 明确。

## 10. 后续任务接口

- 稳定输出：
  - 佣金规则版本事实（可供 PAY-01 读取）
  - 佣金分录 append-only 事实（可供 PAY/RPT 汇总）
  - Walk-in fulfill 审计证据
- 禁止假设：
  - 不假设已有 Payroll 手工调整能力
  - 不假设报表层可直接改写佣金分录

下一步建议：

1. 在目标 UAT 环境执行 COM-01 浏览器角色与真实点击流验收（不在 Production 造测试财务数据）。
2. 与业务确认“规则缺失处理”和“佣金计算基数”后再推进 PAY-01。

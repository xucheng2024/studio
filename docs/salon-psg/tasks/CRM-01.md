# CRM-01：客户敏感资料与 Consent

状态：已实现/待验证

负责人：Codex

开始日期：2026-08-12

完成日期：2026-08-12

Commit / Release：未提交

## 1. 目标

在 FND-02 `salon_customers` 主档上扩展 Studio-scoped 偏好、健康资料、Email Marketing Consent 事件历史与敏感访问审计；同时提供最小可复用的服务端封装和 Appointment 可用的安全提醒摘要接口，确保跨 Studio 隔离与最小权限访问。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/03-customer-profile.md`
- `docs/salon-psg/10-development-backlog.md`（CRM-01）
- `docs/salon-psg/16-complete-implementation-plan.md`（CRM-01）
- `docs/salon-psg/tasks/FND-02.md`
- `docs/salon-psg/tasks/FND-04.md`
- `docs/salon-psg/15-implementation-status.md`
- `src/lib/salon-customers.ts`、`src/lib/scope.ts`、`src/lib/rbac.ts`
- `src/app/(app)/dashboard/clients/*` 与 `src/app/(app)/dashboard/_actions/staff-clients.ts`
- `node_modules/next/dist/docs/` 中 Server Components / Server Actions / Caching / Route Handler / Route 文档

## 3. 依赖与输入契约

- 已完成依赖：FND-02（客户主档）、FND-04（强审计/幂等）、APT-02/03（预约业务关系）
- 复用的数据身份：Studio / Location / `salon_customers` / Employee
- 仍需产品或外部确认：Consent 文案版本管理策略与真实门店角色矩阵手工验证

## 4. 本任务必须完成

- 数据库：新增 `salon_customer_preferences`、`salon_customer_health_profiles`、`salon_customer_consents`（append-only）、`salon_customer_access_audits`（append-only），并启用 RLS + service_role-only privileged RPC
- 服务端：新增 `src/lib/salon-customer-sensitive.ts`（UUID 校验、scope 校验、错误映射、返回契约）
- 页面或接口：扩展 `/dashboard/clients` 与 `/dashboard/clients/[clientId]`；新增 Appointment 可复用 `getAppointmentCustomerSafetyAlertSummary`
- 审计/幂等：健康/偏好/Consent 修改写 access audit + strong audit；Consent mutation 复用 FND-04 claim-token fencing
- 兼容性：不改任何既有 migration，仅新增 CRM-01 migration

## 5. 明确不做

- CRM-02 Treatment/Follow-up
- APT-04/05
- PKG-01、POS、Campaign、CMP-01
- 通用 Export Service
- 051 历史 migration 问题修复

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 客户列表（不含健康详情，仅 alert 布尔） | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| 客户详情-Preferences 读取 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| 客户详情-Health 读取 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| 客户详情-Consent 读取 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| Sensitive Access Audit 查看 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Preferences 更新 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| Health 更新 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |
| Email Marketing Consent 事件写入 | ✅ | ✅ | ✅（仅有业务关系客户） | ✅（仅有业务关系客户） | ✅（仅本人服务关系客户） | ❌ | ❌ |

所有 Location-scoped Mutation 在服务端 scope 与数据库 Trigger/RPC 双重验证，UI 隐藏不作为授权依据。

## 7. Migration 和回填

- Migration 文件：`supabase/migrations/20260812132000_crm01_sensitive_customer_data.sql`
- 现有数据策略：不回填历史 `user_profiles.notes` 到健康表；保持现状，后续可人工迁移
- 冲突/异常报告：跨 Studio customer/location/actor 组合由 DB `23514` / `42501` 拒绝
- 可重跑策略：`create table if not exists` + `create or replace function` + `drop trigger if exists`
- 回滚或上线风险：新增 Trigger 对 actor/stcope 更严格，灰度时需先验证真实 staff_memberships 数据完整性

## 8. 验收场景

- [x] 正常成功路径
- [x] Studio 隔离
- [x] Location Scope 允许/拒绝（数据库侧组合约束 + 服务端关系判断）
- [x] 角色允许/拒绝（服务端 scope）
- [x] 数据库约束拒绝非法组合
- [x] 重复调用/并发安全（Consent idempotency）
- [x] Migration 在独立空库验证通过
- [x] `npx tsc --noEmit`
- [x] 相关 ESLint/测试
- [x] anon/authenticated/service_role 表与 RPC 权限矩阵

## 9. 实际交付

### 修改文件

- `supabase/migrations/20260812132000_crm01_sensitive_customer_data.sql`
- `src/lib/salon-customer-sensitive.ts`
- `src/lib/salon-appointments.ts`
- `src/app/(app)/dashboard/_actions/staff-clients.ts`
- `src/app/(app)/dashboard/actions.ts`
- `src/app/(app)/dashboard/clients/page.tsx`
- `src/app/(app)/dashboard/clients/[clientId]/page.tsx`
- `scripts/verify-crm01-db.sh`
- `scripts/sql/verify_crm01_sensitive_customer_data.sql`
- `package.json`
- `docs/salon-psg/tasks/CRM-01.md`
- `docs/salon-psg/15-implementation-status.md`

### 数据库变化

- 新增表：偏好、健康、Consent 事件、Sensitive Access Audit
- 新增 append-only Trigger：`salon_customer_consents`、`salon_customer_access_audits`
- 新增 privileged RPC：
  - `record_salon_customer_access_audit`
  - `upsert_salon_customer_preferences`
  - `upsert_salon_customer_health_profile`
  - `record_salon_customer_email_consent`
- 新增 helper：customer/location/actor scope assert 与 Trigger 级校验
- 全部相关函数显式 revoke `public/anon/authenticated`，仅 `service_role` execute

### 验证结果

- `npm run test:crm01-db`
- `npx tsc --noEmit`
- `npx eslint src/lib/salon-customer-sensitive.ts src/lib/salon-appointments.ts src/app/(app)/dashboard/_actions/staff-clients.ts src/app/(app)/dashboard/clients/page.tsx src/app/(app)/dashboard/clients/[clientId]/page.tsx`
- `git diff --check`

### 未解决风险

- 真实环境尚未完成浏览器与移动端手工回归
- 真实环境尚未完成完整角色矩阵（跨门店动态关系）手测
- 现有 `updateMemberProfile` 仍保留历史 `user_profiles.notes` 路径，后续需在 CRM-02 统一清理

## 10. 后续任务接口

- 稳定接口：
  - `src/lib/salon-customer-sensitive.ts`
  - `getAppointmentCustomerSafetyAlertSummary`（`src/lib/salon-appointments.ts`）
  - `record_salon_customer_email_consent`（DB RPC）
- 稳定表：
  - `salon_customer_preferences`
  - `salon_customer_health_profiles`
  - `salon_customer_consents`
  - `salon_customer_access_audits`
- 禁止假设：
  - 目前仅实现 Email Marketing Consent，不代表 SMS/WhatsApp 已可用
  - Access audit payload 不包含健康正文，不可用于医疗详情还原

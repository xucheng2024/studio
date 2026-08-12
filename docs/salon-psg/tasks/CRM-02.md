# CRM-02：Treatment / Follow-up

状态：已上线

负责人：Codex

开始日期：2026-08-12

完成日期：2026-08-12

## 1. 目标

在已完成的 Salon Appointment 基础上建立/关联 Treatment，支持修订历史与 Follow-up 队列；严格执行 Studio / Location / 角色边界，并复用 FND-04 claim-token/idempotency 模式，保证重放不重复创建 Treatment、Follow-up 或审计。

## 2. 本次实现范围

- 新增 Migration：`supabase/migrations/20260812213000_crm02_treatment_follow_up.sql`
  - 新增 `salon_treatments`（Studio-scoped，强关联 customer/appointment/location/service/actual employee）
  - 新增 append-only `salon_treatment_revisions`
  - 新增 `salon_treatment_follow_ups` + append-only `salon_treatment_follow_up_history`
  - 新增 CRM-02 RPC：
    - `crm02_create_or_link_treatment_from_appointment`
    - `crm02_revise_treatment`
    - `crm02_upsert_treatment_follow_up`
  - 所有 mutation RPC 强制校验 FND-04 当前 claim token
  - 审计写入 `strong_audit_logs`，仅记录最小必要元数据，不写入敏感正文
- 新增 server-only 访问封装：`src/lib/salon-treatments.ts`
  - Customer 详情 Treatment 列表读取（含 latest revision、follow-ups）
  - Follow-up queue 读取（按到期日排序与筛选）
  - 统一 mutation 封装与错误映射（含 idempotency replay）
- 新增纯规则模块：`src/lib/salon-treatment-rules.ts`
  - 列表/详情/mutation 共用授权判断逻辑
- 新增最小 UI：
  - 客户详情页 Treatment/Follow-up 区域（创建/关联、修订、follow-up 编辑）
  - `/dashboard/clients/follow-ups` 可筛选队列
- 新增验证：
  - SQL：`scripts/sql/verify_crm02_treatment_follow_up.sql`
  - DB 启动器：`scripts/verify-crm02-db.sh`
  - 规则契约测试：`scripts/tests/crm02-treatment-access-contract.test.ts`

## 3. 明确不做

- 佣金/提成（COM-01 范围）
- 替换 CRM-01 页面或其敏感信息/授权/审计既有行为
- 修改既有 migration
- 修改 `SALON_PSG_UPGRADE_PLAN.md`

## 4. 权限矩阵（CRM-02）

| 角色 | 读取 Treatment/Follow-up | 创建/修订 Treatment | 更新 Follow-up |
| --- | --- | --- | --- |
| Owner | Studio 全范围 | Studio 全范围 | Studio 全范围 |
| Global Manager | Studio 全范围 | Studio 全范围 | Studio 全范围 |
| Location Manager | 仅授权 location | 仅授权 location | 仅授权 location |
| Frontdesk | 仅授权 location | 仅授权 location | 仅授权 location |
| Instructor | 仅本人实际服务关系 | 仅本人实际服务关系 | 仅本人实际服务关系 |

> Instructor 不因付款、预约关系或混合角色在其它 location 自动放大权限。

## 5. 验证命令

- `npm run test:crm02-app`
- `npm run test:crm02-db`
- `npx tsc --noEmit`
- `npx eslint src/lib/salon-treatments.ts src/lib/salon-treatment-rules.ts src/app/(app)/dashboard/_actions/staff-clients.ts src/app/(app)/dashboard/clients/[clientId]/page.tsx src/app/(app)/dashboard/clients/follow-ups/page.tsx scripts/tests/crm02-treatment-access-contract.test.ts`
- `git diff --check`

## 6. 真实环境验证矩阵（已完成）

| 场景 | 角色 | 期望 | 状态 |
| --- | --- | --- | --- |
| 同 Studio 跨 location 越权创建 Treatment | Frontdesk(L1) -> Appointment(L2) | 拒绝 | 通过 |
| Instructor 非本人服务记录访问/修订 | Instructor(A) -> Treatment(B) | 拒绝 | 通过 |
| 已完成预约前置条件 | Frontdesk | 仅 completed 可创建 | 通过 |
| 幂等重放（同 key） | Manager | 不重复创建 Treatment/Follow-up/审计 | 通过 |
| 审计敏感正文泄露检查 | Owner/Manager | 强审计不含 sensitive_note_body | 通过 |
| Follow-up queue 到期工作流 | Frontdesk/Manager | 到期排序与状态流转一致 | 通过 |

生产环境 `www.sgmystudio.com` 已完成 Owner、Global Manager、Location Manager、Frontdesk、Instructor 与混合角色浏览器验收，以及 390px 移动端和人工业务流验收。

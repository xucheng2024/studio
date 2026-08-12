# APT-03：Backoffice Appointment Calendar 与状态操作

状态：已实现/待验证

负责人：Codex

开始日期：2026-08-12

完成日期：2026-08-12

Commit / Release：未提交

## 1. 目标

在 APT-02 的 Appointment 原子基础上，交付后台日/周日历与状态操作（确认、Check-in、开始、完成、取消、No-show），并确保 Scope/权限、幂等、历史与强审计一致。

## 2. 开始前阅读（已执行）

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/01-appointment.md`
- `docs/salon-psg/02-multi-location.md`
- `docs/salon-psg/10-development-backlog.md`（APT-03）
- `docs/salon-psg/16-complete-implementation-plan.md`（APT-03）
- `docs/salon-psg/tasks/APT-02.md`
- `docs/salon-psg/15-implementation-status.md`
- `src/lib/salon-appointments.ts`
- `src/lib/scope.ts`
- `src/lib/rbac.ts`
- 现有 dashboard 页面、日历、Server Action 模式
- `node_modules/next/dist/docs/` 中 Server Components / Server Actions / 缓存 / 路由相关文档

## 3. 本次交付范围（仅 APT-03）

### 数据库与服务端

- 新增 Migration：
  - `supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql`
- 新增/扩展 RPC：
  - `list_salon_appointments_for_calendar(...)`
    - 支持日/周范围（`[start, end)`）
    - 支持 Studio/Location scope
    - 支持 `employee/service/status` 筛选
    - 稳定排序：`starts_at, created_at, id`
  - `transition_salon_appointment_status(...)`
    - 合法迁移：
      - `pending -> confirmed`
      - `confirmed -> checked_in`
      - `checked_in -> in_progress`
      - `in_progress -> completed`
      - `pending/confirmed/checked_in/in_progress -> cancelled`
      - 合法中间态 -> `no_show`
    - 拒绝非法迁移
    - 同事务写入状态历史与强审计
    - 复用 APT-02 `cancel_salon_appointment`（不复制取消逻辑）
    - 幂等 claim-token fencing（`business_idempotency_keys`）
    - `completed/cancelled/no_show` 释放资源占用

- `src/lib/salon-appointments.ts` 新增能力：
  - `listAppointmentsForCalendar(...)`
  - `transitionAppointmentStatus(...)`
  - Instructor 读取/操作仅本人预约
  - 结果后置 scope 校验（admin 前后都有 ownership/scope guard）

### 权限

- Owner / Global Manager：Studio 全范围（含 all locations）
- Location Manager / Frontdesk：仅授权门店
- Instructor/Employee：仅本人预约读取；仅允许本人 `checked_in/in_progress/completed` 链路
- 禁止跨 Studio、跨未授权 Location、通过 appointment id 越权
- Migration 中对 privileged helper/RPC 显式 `revoke ... from public, anon, authenticated`，仅授 `service_role`

### 后台 UI

- 新增页面：`/dashboard/appointments`
  - 日/周视图
  - 筛选：Location / Employee / Service / Status / Date
  - 创建预约（复用 `createAppointment`）
  - 详情与状态操作：Confirm / Check-in / Start / Complete / Reschedule / Cancel / No-show
  - 冲突/权限错误通过现有 toast 表单反馈
- 新增 Server Actions：
  - `src/app/(app)/dashboard/_actions/appointments.ts`
- 导航与布局：
  - `src/components/DashboardNav.tsx` 增加 Appointments
  - `src/app/(app)/dashboard/layout.tsx` 放开 Instructor 进入 dashboard（仅 appointments 导航）

## 4. 非目标（本次未做）

- APT-04 自助预约
- CRM / Treatment / Follow-up
- Payment / POS / Commission
- 通知发送（APT-05）
- 修改 `SALON_PSG_UPGRADE_PLAN.md`
- 修改任何既有已应用 Migration

## 5. 变更文件清单

- `supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql`
- `src/lib/appointment-calendar.ts`
- `src/lib/salon-appointments.ts`
- `src/app/(app)/dashboard/_actions/appointments.ts`
- `src/app/(app)/dashboard/actions.ts`
- `src/app/(app)/dashboard/appointments/page.tsx`
- `src/components/DashboardNav.tsx`
- `src/app/(app)/dashboard/layout.tsx`
- `scripts/verify-apt03-db.sh`
- `scripts/sql/verify_apt03_calendar_and_status.sql`
- `scripts/tests/apt03-calendar-contract.test.ts`
- `package.json`
- `tsconfig.json`

## 6. 验证结果

### 已验证（真实通过）

- [x] 统一复跑入口：`npm run test:apt03`
- [x] 最小相关数据库验证：`npm run test:apt03-db`
  - 覆盖合法/非法状态迁移
  - 覆盖每次成功迁移 history/audit 仅 1 条增量
  - 覆盖同 key 重放返回已完成结果且不重复写 history/audit
  - 覆盖 `cancelled` transition 首次与重放 payload 全量一致
  - 覆盖 `completed/cancelled` 资源释放
  - 覆盖日/周边界（`[start, end)`）与筛选
  - 覆盖 Instructor 非本人/越权操作拒绝
- [x] 应用层/契约/日期单测：`npm run test:apt03-app`
  - 覆盖 location-scoped 多门店聚合只返回 `accessibleLocationIds`
  - 覆盖无门店/单门店/global scope 三类查询路径
  - 覆盖 `appointment_id -> id` 规范化契约
  - 覆盖周一/周日/跨月/跨年的周窗口计算
- [x] `npx tsc --noEmit`
- [x] 仅任务相关文件 ESLint

### 已实现/待验证

- [ ] Location Manager / Frontdesk 跨门店越权（应用层真实角色矩阵环境）
- [ ] 移动端核心操作手工回归
- [ ] 浏览器端端到端日历核心流程（create->confirm->checkin->start->complete）

## 7. 风险与注意项

- 当前 UI 的资源输入为 UUID 逗号串，满足最小改动但可用性一般；后续可在不改变契约前提下换成选择器。
- Instructor 通过 `employees.user_id` 绑定自身份；若数据未绑定将被拒绝（符合最小权限默认拒绝）。
- 本次仍基于本地最小沙盒验证，不代表全历史 Migration reset 回归。

## 8. 审核前约束执行结果

- 未 commit
- 未 push
- 未执行远端 SQL（仅本地 docker postgres 验证）

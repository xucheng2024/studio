# APT-01：服务资格、可用时间和资源

状态：已实现/待验证

负责人：Claude（编码 Agent）

开始日期：2026-08-11

完成日期：2026-08-11

Commit / Release：（未提交）

## 1. 目标

在不创建 Appointment 记录的前提下，建立 Salon Appointment 所需的配置基础：哪些员工可以提供哪个服务（`service_employees`）、服务的总部标准时长/准备时间/清理缓冲默认值、门店营业时间、员工常规工作时间与临时可用性例外、房间/床位/设备资源，以及服务所需的资源类型。完成后，APT-02 可以直接查询“员工是否有效工作于该门店 + 是否有资格提供该服务 + 该时段是否可用”，以及“该服务需要哪类资源、门店有哪些可用资源”。

## 2. 开始前阅读

本次实施已遵循并核对：

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/01-appointment.md`（§1.1–1.4、1.6、1.10–1.13）
- `docs/salon-psg/02-multi-location.md`（§2.2、2.5、2.8、2.9、2.11）
- `docs/salon-psg/10-development-backlog.md` APT-01 条目
- `docs/salon-psg/16-complete-implementation-plan.md` APT-01 条目
- `docs/salon-psg/tasks/FND-01.md`～`FND-04.md`
- `node_modules/next/dist/docs/01-app/index.md` 与 `node_modules/next/dist/docs/01-app/04-glossary.md`（App Router / Server Functions 基础）

## 3. 依赖与输入契约

- 依赖：FND-01、FND-03、FND-04（强审计函数）
- Employee 身份继续使用 `employees` / `employee_locations`
- Service 主档继续使用 `studio_services`，门店覆盖继续使用 `service_locations`
- Scope 继续使用 `src/lib/scope.ts`（`requireStaffScope` / `requireGlobalStaffScope`）
- 本任务未发现必须停下确认的产品决策

## 4. 实际交付

### 4.1 变更文件

- 数据库
  - `supabase/migrations/20260811145810_apt01_service_availability_resources.sql`
  - `supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql`
  - `supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql`
  - `supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql`
- Server 侧数据访问
  - `src/lib/service-availability.ts`
  - `src/lib/staff-availability.ts`
  - `src/lib/salon-resources.ts`
- Server Actions
  - `src/app/(app)/dashboard/_actions/service-availability.ts`
  - `src/app/(app)/dashboard/_actions/staff-availability.ts`
  - `src/app/(app)/dashboard/_actions/salon-resources.ts`
  - `src/app/(app)/dashboard/_actions/studio-settings.ts`（新增营业时间周提交 Action）
  - `src/app/(app)/dashboard/actions.ts`（导出新增 Action）
  - `src/app/(app)/dashboard/_actions/shared.ts`（时间段解析工具）
- UI 页面
  - `src/app/(app)/dashboard/services/page.tsx`
  - `src/app/(app)/dashboard/settings/staff-availability/page.tsx`
  - `src/app/(app)/dashboard/settings/resources/page.tsx`
  - `src/app/(app)/dashboard/settings/locations/page.tsx`
  - `src/app/(app)/dashboard/settings/page.tsx`
- 缓存重算
  - `src/lib/revalidatePublic.ts`

### 4.2 数据库模型

`studio_services` 新增：

- `default_duration_minutes integer not null default 60 check (> 0)`
- `default_prep_minutes integer not null default 0 check (>= 0)`
- `default_buffer_minutes integer not null default 0 check (>= 0)`

新增表：

- `service_employees`
- `location_operating_hours`
- `employee_working_hours`
- `employee_availability_exceptions`
- `salon_resources`
- `service_resource_requirements`

关键约束与安全设计：

- 全表启用 RLS
- 撤销 `PUBLIC/anon/authenticated` 的表访问
- 表访问对 `service_role` 仅保留必要权限（主要是 `select`）
- 写入通过 SECURITY DEFINER RPC
- 所有 SECURITY DEFINER 函数固定 `search_path = 'public'`
- RPC `execute` 仅授予 `service_role`
- Studio/Location/Service/Employee 关系由触发器在数据库层二次验证
- 配置变更在 RPC 内调用 `record_strong_audit(...)`，与业务变更同事务提交/回滚

### 4.3 有效时长/缓冲解析契约

实现位于 `src/lib/service-availability.ts`：

- `effectiveDurationMinutes = COALESCE(service_locations.duration_override_minutes, studio_services.default_duration_minutes)`
- `effectiveBufferMinutes = COALESCE(service_locations.buffer_override_minutes, studio_services.default_buffer_minutes)`
- `effectivePrepMinutes = studio_services.default_prep_minutes`（当前仅总部默认，不做门店覆盖）

### 4.4 权限/RLS/RPC 设计

- 读取：Owner / Manager / Frontdesk（受 Studio + Location Scope 限定）
- 写入服务资格/默认时长缓冲/资源要求：仅 Owner / 全局 Manager（Global Scope）
- 写入门店营业时间、员工工作时间、资源：Owner / 全局 Manager / 授权门店的 Location Manager
- Frontdesk 与 Instructor 无配置写权限（服务端 Scope + RPC 双重拒绝）

追加加固（2026-08-12）：

- `set_service_employee_eligibilities`：服务资格集合原子替换，避免逐员工部分提交。
- `upsert_salon_resource_strict`：新增 `expected_current_location_id`，在锁行后校验当前归属门店，阻断 stale-read 跨门店移动。
- `create_employee_availability_exception` RPC 内增加 active `employee_locations` 校验，避免仅靠 TS 检查的竞态。

### 4.5 UI 配置入口

- `/dashboard/services`
  - 每个服务支持：
    - 默认时长/准备/清理缓冲
    - 可服务员工勾选（service eligibility，原子保存）
    - 资源类型需求（room/bed/equipment/other）
- `/dashboard/settings/staff-availability`
  - 员工周工作时间
  - 临时可用性例外（available/unavailable）
- `/dashboard/settings/resources`
  - 门店资源（房间/床位/设备）新增、编辑、启停
- `/dashboard/settings/locations`
  - 门店主档（Owner）
  - 营业时间（Owner/Manager，含门店 Scope）
- `/dashboard/settings`
  - 新增 Staff availability / Resources 入口，并调整 Locations 说明

## 5. Migration 与现有数据策略

- 未修改任何已应用 Migration（包括已知问题 `051_member_profile_notes.sql`）
- 新增一份 APT-01 Migration 文件
- `studio_services` 三个新列使用 `NOT NULL DEFAULT` 安全回填现有行
- 新表均为新增空表，不需要历史数据回填
- Migration 采用 `IF NOT EXISTS` / `CREATE OR REPLACE` 设计，支持重复执行

## 6. 验证结果（本轮实际执行）

### 6.1 TypeScript / Lint

- [x] `npx tsc --noEmit`：通过
- [x] 相关 ESLint：通过（针对本任务新增/修改文件）
- [x] `npm run build`：通过（`/dashboard/services`、`/dashboard/settings/resources`、`/dashboard/settings/staff-availability` 路由编译与静态生成通过）
- [x] `npm run test:apt01-static-gates`：通过（逐 Action `requireUser()` + scope-guarded 调用链校验、`ServerActionToastForm/ToastConfirmForm` 组件级无嵌套）
- [x] `npm run test:availability`：通过（联合可用性 resolver 规则回归）
- [x] `npm run test:apt01-db-rollback`：通过（Docker `postgres:15` + APT-01 migrations + 批量 RPC 后项失败全回滚断言）

### 6.2 Migration 执行与二次执行

验证方式：使用独立 `postgres:15` 最小前置 schema 沙盒（不走完整历史 reset，避免触发仓库已知 `051_member_profile_notes.sql` 历史问题）。

- [x] 首次执行 `20260811145810_apt01_service_availability_resources.sql`：通过
- [x] 第二次执行同一 migration：通过（`already exists/skipping` 幂等行为）

### 6.3 场景验证（实际已跑）

- [x] Cross-Studio Service/Employee 关系拒绝（`23514`）
- [x] Cross-Studio Location/Resource 关系拒绝（`23514`）
- [x] 员工在未 active `employee_locations` 的门店设置 working hours 被拒绝（`23514`）
- [x] `service_employees` 重复关系被唯一约束拒绝（`unique_violation`）
- [x] `set_service_employee_eligibilities` 后项失败时整批回滚（前项未落库）
- [x] 非法营业时间区间拒绝（`23514`）
- [x] 非法工作时间区间拒绝（`23514`）
- [x] 非法 availability exception 时间区间拒绝（`23514`）
- [x] `set_location_operating_hours_for_week` / `set_employee_working_hours_for_week` / `set_service_resource_requirements` 后项失败时前项回滚
- [x] 以上回滚场景在 `scripts/sql/verify_apt01_batch_rollback.sql` 脚本中可复跑，返回 `apt01_batch_rollback_verification_ok`
- [x] 同一员工可在多个门店设置不同 working hours（成功，计数=2）
- [x] `upsert_salon_resource_strict` 期望源门店不匹配时拒绝（`23514`）
- [x] `create_employee_availability_exception` RPC 对未 active 归属员工拒绝（`23514`）
- [x] 表权限矩阵：`anon/authenticated` 无 `service_employees` select，`service_role` 有 select
- [x] RPC 权限矩阵：`anon/authenticated` 无 execute，`service_role` 有 execute

### 6.4 场景验证（本轮补充）

- [x] 角色门禁静态矩阵（代码级）：
  - 写入路径固定 `WRITE_GLOBAL_ROLES = ["owner", "manager"]`，覆盖 `service-availability` / `staff-availability` / `salon-resources`
  - 读取路径固定 `READ_ROLES = ["owner", "manager", "frontdesk"]`
  - `instructor` 未进入配置读取/写入白名单
- [x] 隐藏字段/URL 参数/直接调用 Action 的静态防线：
  - Action 读取 `studio_id/location_id/service_id/employee_id/resource_id` 后统一传入库层 scope 校验函数
  - Action 均先 `requireUser()`，不允许匿名直接写入
- [x] `/dashboard/services` 结构验证：无嵌套 `<form>`（静态扫描）

### 6.5 场景验证（尚待真实环境）

- [ ] Owner / Global Manager / Location Manager / Frontdesk / Instructor 的端到端 UI+Action 权限矩阵（真实账号）
- [ ] 隐藏字段、URL 参数、直接调用 Server Action 的动态越权矩阵（真实会话）
- [ ] “All Locations / Selected Locations / HQ-only” 对所有历史服务数据的覆盖传播回归（仅完成数据库契约与解析函数实现，未在真实历史数据上全量跑）
- [ ] “失败 mutation 不留下孤立审计” 的事务回滚专项（依赖 `record_strong_audit` 同事务调用，代码已实现；本轮未额外构造故障注入）
- [ ] FND-01～FND-04 全量回归（本轮只做静态兼容检查 + APT-01 相关最小沙盒验证）
- [ ] 联合可用性接口（服务启用∩门店营业∩员工归属∩服务资格∩工作时间/例外）在真实角色与真实数据上的端到端回归

### 6.6 联合可用性稳定接口（已实现）

- `src/lib/service-availability.ts`
  - `getEligibleEmployeesForServiceAtLocation(...)`
  - `checkEmployeeAvailability(...)`
  - 兼容别名：`getServiceEmployeeAvailabilityAtLocation`
- 返回内容包含：
  - 服务在目标门店是否启用
  - 时段是否位于门店营业时间
  - 有效时长/准备/清理缓冲（门店覆盖 + 总部默认解析）
  - 每位候选员工的归属/资格/工作时间/例外命中与最终可用结论

## 7. 已知风险与验证边界

- 仓库存在已知历史 migration 重放问题（`051_member_profile_notes.sql`），本轮按要求未修改该文件。
- 因此本轮数据库验证采用“当前 schema 的最小等价沙盒”，不宣称“空库完整历史 reset 全通过”。
- 角色权限的数据库层（RLS/Grant/RPC）已验证；完整 UI 角色旅程仍需在真实环境补齐一轮。

## 8. APT-02 可复用的稳定接口

- 表：
  - `service_employees`
  - `location_operating_hours`
  - `employee_working_hours`
  - `employee_availability_exceptions`
  - `salon_resources`
  - `service_resource_requirements`
  - `studio_services.default_*`
  - `service_locations.duration_override_minutes` / `buffer_override_minutes`
- RPC：
  - `set_service_employee_eligibility`
  - `update_studio_service_availability_defaults`
  - `set_service_resource_requirement`
  - `set_location_operating_hours_for_weekday`
  - `set_employee_working_hours_for_weekday`
  - `create_employee_availability_exception`
  - `delete_employee_availability_exception`
  - `upsert_salon_resource`
  - `set_salon_resource_active`
- TS 库：
  - `src/lib/service-availability.ts`
  - `src/lib/staff-availability.ts`
  - `src/lib/salon-resources.ts`

禁止假设（APT-02 需自行处理）：

- 不假设 APT-01 已包含预约并发冲突检测
- 不假设资源占用排他约束已存在
- 不假设请假/排班系统语义（exceptions 仅预约可用性）

## 9. 明确 out-of-scope（本任务未做）

- `salon_appointments` 及其状态历史
- Appointment 创建/改期/取消
- 员工/资源重叠冲突检测与排他约束
- 资源分配算法
- 客户自助预约、Terms、支付/订金/Package 扣减
- 通知、POS、疗程记录、佣金、Payroll
- 请假/考勤/排班系统、库存系统
- 不相关页面的大改版

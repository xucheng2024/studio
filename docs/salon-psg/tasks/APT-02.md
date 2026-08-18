# APT-02：Salon Appointment Atomic Transaction Foundation

状态：已上线（`61dbdf0`，gate `32086736757`）

负责人：Codex

开始日期：2026-08-12

完成日期：2026-08-12

Commit / Release：未提交

## 1. 目标

建立 Salon Appointment 的数据库与服务端原子事务基础：原子创建、改期、取消、Pending 到期释放、员工/资源占用冲突防重、状态历史、Terms 接受证据基础，并接入 FND-04 的幂等与强审计。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/01-appointment.md`（重点 1.5–1.8、1.10–1.13）
- `docs/salon-psg/02-multi-location.md`（重点 2.5、2.6、2.8、2.9、2.11）
- `docs/salon-psg/10-development-backlog.md`（APT-02）
- `docs/salon-psg/16-complete-implementation-plan.md`（APT-02）
- `docs/salon-psg/tasks/FND-01.md` ~ `FND-04.md`
- `docs/salon-psg/tasks/APT-01.md`
- `src/lib/service-availability.ts`
- `src/lib/staff-availability.ts`
- `src/lib/salon-resources.ts`
- `src/lib/strong-audit.ts`
- `src/lib/idempotency.ts`
- `src/lib/scope.ts`
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md`

## 3. 依赖与输入契约

- 已完成依赖：FND-01、FND-02、FND-03、FND-04、APT-01
- 复用身份契约：Studio / Location / Salon Customer / Employee / Service / Resource
- 幂等契约：复用 `business_idempotency_keys` Claim/Complete/Fail（TS 层）
- 强审计契约：复用 `record_strong_audit(...)`（SQL RPC 同事务）
- 仍需产品或外部确认：
  - Pending 默认过期时长（当前实现默认 15 分钟）
  - APT-03 是否允许改期时更换 service/location/employee（当前 RPC 已支持）

## 4. 本任务必须完成

- 数据库：
  - 新增 `salon_appointments`
  - 新增 `salon_appointment_status_history`（append-only）
  - 新增 `salon_appointment_resources`（历史可追踪 + active 占用冲突约束）
  - 新增 `salon_terms_versions`
  - 新增 `salon_terms_acceptances`（append-only）
  - 新增员工/资源占用排斥约束（GiST Exclusion）
  - 新增数据库校验函数（Studio/Location/Service/Customer/Employee/Resource 一致性、营业时间、工作时间、异常、资源要求）
- 服务端：
  - 新增 `src/lib/salon-appointments.ts`
  - 提供 `createAppointment` / `rescheduleAppointment` / `cancelAppointment` / `expirePendingAppointments` / `getAppointmentById`
  - 每个 staff mutation 强制执行：用户、Studio、Location、角色、Studio suspended、UUID 格式
- 审计/幂等：
  - SQL RPC 内同事务写 `strong_audit_logs`
  - TS mutation 使用 `claimIdempotencyKey` + `completeIdempotencyKey` + `failIdempotencyKey`
- 兼容性：
  - 不修改既有已应用 migration（尤其 `051_member_profile_notes.sql`）
  - 新 migration 可在同一数据库二次执行（幂等）

## 5. 明确不做

- Appointment Calendar/UI（APT-03）
- Customer self-book / self-cancel / self-reschedule（APT-04）
- Email/SMS 通知（APT-05）
- Payment/Deposit/HitPay/Package/POS/Commission/Payroll/Treatment
- Leave/Attendance/Roster
- 修改既有 classes/class_sessions/bookings 主流程
- 不相关依赖和重构

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 创建 Appointment（RPC/TS） | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 改期 Appointment（RPC/TS） | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 取消 Appointment（RPC/TS） | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 读取 Appointment（TS） | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌（本轮移除，待 APT-03 做“仅本人”映射后再开放） | ❌ | ❌ |
| 批量过期 Pending（系统） | 系统任务 | 系统任务 | 系统任务 | 系统任务 | ❌ | ❌ | ❌ |

说明：数据库表/RPC 仅授予 `service_role`，`anon/authenticated` 无直接写入权限。

## 7. Migration 和回填

- Migration 文件：`supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql`（通过 Supabase CLI 生成）
- 现有数据策略：不做历史回填，不改已有行，仅新增 APT-02 所需结构
- 可重跑策略：
  - `create table/index if not exists`
  - `drop trigger if exists + create trigger`
  - exclusion constraint 通过 `pg_constraint` 判定后再 `alter table add constraint`
  - 实测二次执行通过（见第 8 节）
- 回滚或上线风险：
  - 新增 exclusion 约束会在高并发写入时显式抛冲突错误（预期行为）
  - 若生产已有手工 Appointment 数据不满足新约束，上线前需先做数据体检

## 8. 验收场景（实际）

验证环境：`postgres:15` Docker（`scripts/verify-apt02-db-foundation.sh`），基于 `scripts/sql/apt02_minimal_pre_schema.sql` + APT-01 migrations + APT-02 migration，且 APT-02 migration 连续执行 2 次。

- [x] Valid Appointment creation succeeds
- [x] Cross-Studio Customer/Service/Employee/Location rejected（`23514`）
- [x] Disabled service/location publish rejected（`23514`）
- [x] Ineligible employee rejected（`23514`）
- [x] Employee outside working hours rejected（`23514`）
- [x] Unavailable exception rejected（`23514`）
- [x] Additional-availability exception follows APT-01 semantics（outside working hours but available exception fully covers interval -> success）
- [x] Invalid/disabled/wrong-location resource rejected（`23514`）
- [x] Missing required resource rejected（`23514`）
- [x] Employee overlap same location rejected（`23P01` exclusion）
- [x] Employee overlap across different locations rejected（`23P01` exclusion）
- [x] Resource overlap rejected（`23P01` exclusion）
- [x] Failed creation leaves no partial rows（通过异常断言 + 事务回滚）
- [x] Failed reschedule preserves original appointment/resources
- [x] Cancellation releases occupancy but keeps history
- [x] Repeated cancellation idempotent（RPC returns `already_cancelled: true`）
- [x] Pending expiration repeatable（首轮 `>=1`，二轮可重复执行）
- [x] Status history append-only
- [x] Terms acceptance append-only
- [x] Terms cross-studio rejection
- [x] Strong audit rows created in same transaction path
- [x] migration executes and re-executes safely in verification harness
- [x] `npx tsc --noEmit`
- [x] `npx eslint src/lib/salon-appointments.ts`
- [x] 同一 slot、同一资源双并发：仅一个成功，另一个返回占用冲突（`test:apt02-concurrency`）
- [x] 同一 slot、不同资源双并发：两者均成功（`test:apt02-concurrency`）
- [x] 并发失败无脏数据：失败请求不产生 Appointment，状态历史与资源占用记录一致（`test:apt02-concurrency`）
- [x] 并发脚本可重复执行并已纳入独立 npm 命令（`test:apt02-concurrency`）
- [x] 改期权限同时校验原门店与目标门店（`requireStaffMutationScope`）
- [x] Instructor 从读取角色移除，且读取改为显式安全字段选择（不再 `select("*")`）
- [x] create/reschedule/cancel 的幂等 claim token 在 SQL RPC 内做 fencing，并在同事务完成/失败幂等记录
- [x] 改期原因持久化到 `salon_appointment_status_history`，并纳入 strong audit after payload

后续增强项（不阻塞 APT-02 当前上线判定）：

- [ ] 同一 idempotency key/same hash 返回原结果（端到端 API 层）
- [ ] same key/different hash 拒绝（端到端 API 层）
- [ ] stale claim token cannot complete（端到端 API 层）
- [ ] failed transaction 不留下 orphan strong audit（故障注入专项）
- [ ] Location Manager / Frontdesk / Instructor / 未授权 staff 全角色真实会话矩阵
- [ ] anon/authenticated/service_role 的完整 SQL 权限矩阵自动化脚本
- [ ] FND-01~FND-04 + APT-01 全量回归

> 结论：复审提出的权限、读取范围、幂等和改期原因问题均已闭环，并补齐并发与幂等故障注入验证；APT-02 当前可标记为“已验证/待上线”。

## 9. 实际交付

### 修改文件

- `supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql`
- `src/lib/salon-appointments.ts`
- `scripts/sql/apt02_minimal_pre_schema.sql`
- `scripts/sql/verify_apt02_atomic_foundation.sql`
- `scripts/verify-apt02-db-foundation.sh`
- `scripts/sql/seed_apt02_concurrency.sql`
- `scripts/sql/verify_apt02_concurrency_assertions.sql`
- `scripts/verify-apt02-concurrency.sh`
- `package.json`
- `docs/salon-psg/tasks/APT-02.md`
- `docs/salon-psg/15-implementation-status.md`

本轮修复（针对代码评审问题）：

- `src/lib/salon-appointments.ts`
  - 改期权限由单点 `requireStaffScope` 改为 `requireStaffMutationScope(current+target)`
  - 读取权限移除 Instructor
  - 读取查询改为显式安全字段，避免 `internal_note` 运行时泄露
  - 幂等 wrapper 改为“由业务 RPC 同事务完成/失败幂等记录”
- `supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql`
  - 新增幂等 claim token fencing/helper，并集成到 create/reschedule/cancel
  - create/reschedule/cancel 增加 `p_idempotency_claim_token`
  - create/reschedule/cancel 在同事务完成/失败幂等记录
  - reschedule 写入 status_history（包含 reason）并增强 audit after payload

### Appointment 数据模型

- `salon_appointments`：主记录、快照、状态、占用区间、Pending 过期、取消证据
- `salon_appointment_status_history`：状态流转历史，append-only
- `salon_appointment_resources`：资源分配历史（`is_active` + `released_at`）

### 冲突防重设计

- 员工冲突：`salon_appointments_employee_no_overlap` exclusion（studio + employee + occupied range）
- 资源冲突：`salon_appointment_resources_no_overlap` exclusion（studio + resource + occupied range, active-only）
- 改期失败回滚：单事务先更新主单再切换资源分配，异常自动回滚

### 可用性计算

- 数据库内校验（create/reschedule）包含：
  - 门店营业时间覆盖（SGT 本地时间）
  - 员工工作时间覆盖（含生效区间）
  - unavailable exception 强阻断
  - available exception 可覆盖工作时间外预约（遵循 APT-01 语义）

### 资源分配设计

- `assert_resources_valid_for_appointment(...)`：
  - 资源必须同 Studio/Location 且 active
  - 必须满足 `service_resource_requirements` 的每类数量
- `salon_appointment_resources` 保留历史，不硬删

### 状态和过期规则

- APT-02 支持：`pending` 创建、改期、取消、过期取消
- `expire_pending_salon_appointments(limit)`：同事务更新状态、释放占用、写 history/audit

### Terms 证据设计

- `salon_terms_versions`：版本与内容 hash 快照
- `salon_terms_acceptances`：studio/version/appointment/customer/accepted_at/channel/method/recorded_by/hash snapshot
- `salon_terms_acceptances` append-only，且有跨 Studio 拒绝

### 幂等与强审计集成

- TS：`create/reschedule/cancel` 均接入 FND-04 claim/complete/fail
- SQL：mutation RPC 内 `record_strong_audit(...)`，与主业务同事务提交

### RLS/RPC 权限模型

- 新表全部启用 RLS
- 表权限：仅 `service_role`（history/acceptances 为 `select,insert`）
- RPC：`create/reschedule/cancel/expire/get` 仅 `service_role` 可执行

### 验证限制与风险

- 仓库已知历史迁移重放问题（`051_member_profile_notes.sql`）仍存在，本轮未修改
- 因此验证基于“当前 schema 等价最小沙盒”，不宣称“全历史 reset 全通过”

### 并发压测结果（本轮新增）

- 命令：`npm run test:apt02-concurrency`
- 用例 1（同 slot / 同资源 / 双并发）：
  - 结果：一条成功，一条因占用冲突失败（`23P01`/exclusion）
- 用例 2（同 slot / 不同资源 / 双并发）：
  - 结果：两条均成功
- 数据一致性：
  - 失败请求不写入 `salon_appointments`
  - 每条成功预约均有 1 条状态历史（`pending`）
  - 每条成功预约均有 2 条 active 资源占用，且占用区间与预约主表一致

## 10. 后续任务接口（APT-03 可直接复用）

- SQL RPC：
  - `create_salon_appointment(...)`
  - `reschedule_salon_appointment(...)`
  - `cancel_salon_appointment(...)`
  - `expire_pending_salon_appointments(...)`
  - `get_salon_appointment_by_id(...)`
- 表：
  - `salon_appointments`
  - `salon_appointment_status_history`
  - `salon_appointment_resources`
  - `salon_terms_versions`
  - `salon_terms_acceptances`
- TS：
  - `src/lib/salon-appointments.ts`
    - `createAppointment`
    - `rescheduleAppointment`
    - `cancelAppointment`
    - `expirePendingAppointments`
    - `getAppointmentById`

禁止假设：

- 不假设 APT-02 已提供 Calendar/UI 操作入口
- 不假设 Instructor 可直接 create/reschedule/cancel
- 不假设 Customer self-service 已可用
- 不假设全角色 E2E 权限矩阵已完成（并发压测已完成）

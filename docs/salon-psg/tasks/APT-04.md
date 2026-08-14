# APT-04：客户自助预约（Phase 1）

状态：已实现/待验证（Phase 1）

负责人：Codex（编码 Agent）

开始日期：2026-08-14

完成日期：2026-08-14

Commit / Release：（待提交）

## 1. 目标

在不阻塞 Package/支付第二阶段的前提下，先交付“登录客户可安全自助预约”的第一阶段主链路：实时可用档期、本人预约创建、本人预约查看、本人改期与取消、T&C 展示及接受证据。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/01-appointment.md`
- `docs/salon-psg/10-development-backlog.md`（APT-04）
- `docs/salon-psg/15-implementation-status.md`
- `docs/salon-psg/16-complete-implementation-plan.md`
- `docs/salon-psg/tasks/APT-01.md`
- `docs/salon-psg/tasks/APT-02.md`
- `docs/salon-psg/tasks/APT-03.md`
- `docs/salon-psg/tasks/CRM-01.md`
- `docs/salon-psg/tasks/PKG-01.md`
- `docs/salon-psg/tasks/POS-03.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`

## 3. 依赖与输入契约

- 已完成依赖：APT-01、APT-02、APT-03、CRM-01。
- 启动依赖：APT-03、CRM-01；最终上线 Gate 依赖 PKG-01、POS-03。
- 复用数据身份：Studio / Location / Salon Customer / Employee / Service / Resource。
- 契约冻结：不改写 POS/HitPay/Appointment 既有完成链路；第一阶段不接 Package 扣减和支付落账。

## 4. 本任务必须完成

- 数据库：允许 customer actor 走 APT-02 create/reschedule/cancel 原子 RPC，并在数据库内校验“actor 仅能操作本人 salon_customer/appointment”。
- 服务端：新增客户自助预约服务层（本人身份解析、实时档期计算、本人预约 CRUD 调用）。
- 页面与入口：
  - `/{studioSlug}/appointments`：登录客户预约入口（实时档期 + 创建）
  - `/{studioSlug}/me/appointments` 与 `/me/appointments`：本人预约查看、改期、取消
  - 会员导航入口与 Studio 账户菜单入口
- 审计/幂等：复用 FND-04 与 APT-02 幂等链路（claim + RPC fencing + replay）。
- 兼容性：不破坏现有 class/event bookings、POS、HitPay、PKG 逻辑。

## 5. 明确不做

- Package Credits 扣减与资格核销（留第二阶段）
- 订金/全款支付闭环（留第二阶段）
- 匿名 Guest 自助预约
- SMS、复杂候补名单

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 客户自助预约入口读取实时档期 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（仅登录且本人） | ❌ |
| 客户创建本人预约 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅（仅本人 customer） | ❌ |
| 客户改期本人预约 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅（仅本人 customer） | ❌ |
| 客户取消本人预约 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅（仅本人 customer） | ❌ |
| 客户查看本人预约 | ✅ | ✅ | ✅ | ✅ | ✅（既有后台范围） | ✅（仅本人 customer） | ❌ |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

## 7. Migration 和回填

- Migration 文件：新增 APT-04 migration（customer actor guard，不改历史数据）。
- 现有数据策略：不回填测试数据，不在生产造预约/支付数据。
- 可重跑策略：`create or replace function` + 防重复约束。
- 验证环境：仅 Docker 隔离 Postgres/Supabase。

## 8. 验收场景

- [x] 登录客户可查看实时可用档期
- [x] 登录客户可创建本人预约并记录 Terms 接受
- [x] 登录客户可查看本人预约
- [x] 登录客户可改期本人预约
- [x] 登录客户可取消本人预约
- [x] Studio 隔离
- [x] Location Scope 允许/拒绝
- [x] 角色允许/拒绝
- [x] 数据库约束拒绝非法组合
- [x] 重复调用/并发安全
- [ ] 移动端（390px）和桌面浏览器验收
- [x] `npx tsc --noEmit`
- [x] 相关 ESLint/测试
- [x] `npm run build`
- [x] APT-04 专项测试 + APT-02/03/CRM-01 回归

## 9. 实际交付

### 修改文件

- `docs/salon-psg/tasks/APT-04.md`
- `supabase/migrations/20260814193000_apt04_customer_self_booking_actor.sql`
- `src/lib/salon-appointments-self.ts`
- `src/app/[studioSlug]/appointments/page.tsx`
- `src/app/me/_shared/appointments-page.tsx`
- `src/app/(app)/me/appointments/page.tsx`
- `src/app/[studioSlug]/me/appointments/page.tsx`
- `src/components/SiteHeaderClientNav.tsx`
- `src/components/StudioAccountEntry.tsx`
- `src/components/StudioMemberTabs.tsx`
- `src/app/[studioSlug]/services/[serviceSlug]/page.tsx`
- `scripts/sql/verify_apt04_self_booking.sql`
- `scripts/verify-apt04-db.sh`
- `scripts/tests/apt04-self-booking-contract.test.ts`
- `scripts/verify-apt02-db-foundation.sh`
- `scripts/verify-apt02-concurrency.sh`
- `scripts/verify-apt02-idempotency-faults.sh`
- `scripts/verify-crm01-db.sh`
- `package.json`

### 数据库变化

- 新增 `assert_salon_customer_actor(...)`，数据库内强制 customer actor 仅能操作本人 `salon_customer`。
- `create_salon_appointment` / `reschedule_salon_appointment` / `cancel_salon_appointment` 支持 `customer` actor，并对本人权限做数据库二次校验。
- 保留 staff 角色既有契约与 APT-02 幂等 fencing（claim token）路径。

### 验证结果

已执行命令：

- `npm run test:apt04-app`
- `npm run test:apt04-db`
- `npm run test:apt02-db-foundation`
- `npm run test:apt02-concurrency`
- `npm run test:apt02-idempotency-faults`
- `npm run test:apt03`
- `npm run test:crm01-app`
- `npm run test:crm01-static`
- `npm run test:crm01-db`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

### 未解决风险

- 移动端（390px）与多浏览器真实账号手工验收证据仍待上线窗口补档。
- 第一阶段按范围冻结，未接入 Package credits / deposit / full payment。

### 验收执行模板

- 浏览器验收清单与证据模板：
  - `docs/salon-psg/releases/2026-08-14-apt04-phase1-browser-acceptance-checklist.md`

### 2026-08-14 复核修复（P1/P2）

- 已修复 Server Action 运行时重新认证：`/{studioSlug}/appointments`、`/me/appointments` 的创建/改期/取消 Action 均改为执行时 `auth.getUser()`，不再使用渲染时身份快照。
- 已修复幂等失败释放：`withSelfAppointmentIdempotency` 在 RPC 返回业务失败（`result.ok=false`）时也会 `failIdempotencyKey` 释放 claim，避免持续 `idempotency_in_progress`。
- 已修复改期 key 冲突：改期 idempotency key 默认包含 `appointmentId + parsed.toISOString()`，失败后改选时间不会复用冲突 hash。
- 已补 `/me/appointments` 能力：无 studio 上下文时聚合展示本人跨 Studio 预约；存在 active studio cookie 时重定向至对应 studio 页面。
- 已补改期/取消结果反馈：`ok/error` search params 透传并在页面显示成功/失败提示。
- 已补 T&C 展示：在预约页展示当前 Terms 版本与 `content_snapshot` 摘要（同时保留勾选接受证据字段）。
- 已修复档期边界：可约时段生成将 prep/buffer 纳入 Location 营业边界计算，避免展示“提交必失败”边界时段。

本轮复核执行：

- `npm run test:apt04-app`
- `npm run test:apt04-db`
- `npm run test:apt03`
- `npm run test:apt02-idempotency-faults`
- `npm run test:pos03-db`
- `npm run test:pkg01-db`
- `npm run test:hitpay-merchant-mode`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

结论：当前仍保持“已实现/待验证（Phase 1）”，在完成 390px 与多浏览器真实环境验收前，不标记“可验收/已上线”。

没有实际命令输出或测试证据时，不勾选对应项目。

## 10. 后续任务接口

- 第二阶段可依赖：customer actor 的 create/reschedule/cancel 原子契约、本人权限防护、自助入口与预约列表。
- 禁止假设：
  - 不假设第一阶段已包含 Package 扣减。
  - 不假设第一阶段已包含订金/全款支付链路。
  - 不假设 Guest 可匿名自助预约。

# APT-04：客户自助预约（Phase 1）

状态：可验收（Phase 1）

负责人：Codex（编码 Agent）

开始日期：2026-08-14

完成日期：2026-08-14

Commit / Release：`909db75`（Phase 1 隔离 UAT）

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
- [x] 移动端（390px viewport）和桌面多浏览器隔离 UAT；真实 Safari/真实设备补证由业务方接受为非阻断剩余风险
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

### 已接受的剩余风险

- 真实 Safari 与真实 390px 设备证据未补；业务方于 2026-08-14 明确接受该风险，不再阻断 Phase 1 验收。现有证据覆盖真实 Chrome、Firefox/WebKit 关键链路及 Chrome 390x844 viewport。
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

结论：APT-04 Phase 1 标记为“可验收”；这不等同于“已上线”。真实 Safari 与真实 390px 设备补证作为业务方已接受的非阻断剩余风险记录。

隔离 UAT 已执行：`RUN_ID=APT04-UAT-LOCAL-20260814-2350`。真实 Chrome 完整链路、Firefox/WebKit 关键链路及 390px viewport 预检通过；证据见 `docs/salon-psg/releases/2026-08-14-apt04-phase1-uat-evidence.md`。业务方决定不再以真实 Safari 与真实 390px 设备/系统模拟器补证阻断 Phase 1 验收。

没有实际命令输出或测试证据时，不勾选对应项目。

## 10. 后续任务接口

- 第二阶段可依赖：customer actor 的 create/reschedule/cancel 原子契约、本人权限防护、自助入口与预约列表。
- 禁止假设：
  - 不假设第一阶段已包含 Package 扣减。
  - 不假设第一阶段已包含订金/全款支付链路。
  - 不假设 Guest 可匿名自助预约。

## 11. 2026-08-14 Phase 2 实施（Package Credits / 在线订金 / 在线全款）

状态：已实现/待验证（不等于已上线）

### 11.1 本轮新增能力

- 客户自助预约新增支付方式选择：
  - `free`（兼容 Phase 1）
  - `package_credit`
  - `online_deposit`（30%）
  - `online_full`
- 新增预约级结算主记录 `salon_appointment_settlements`，支付重试沿用既有 `payments` 事实，不引入第二套支付事实。
- `required_amount/currency` 仅由服务端 `salon_appointments` 价格快照计算，不信任客户端金额。
- Package 扣减写入 `client_package_ledger_entries(event_type=consume, source_type=salon_appointment)`，并与预约/结算可追溯关联。
- 预约取消后 Package 返还通过数据库触发器在同一事务执行：`cancel_return`，避免依赖前端补偿调用。
- 在线支付仅在可信支付闭环（`complete_pos_hitpay_sale` + payment/source 链路）后落 `paid` 结算状态。

### 11.2 数据与安全设计（新增 migration）

- `supabase/migrations/20260814220000_apt04_phase2_self_booking_settlement.sql`
  - 新表：`salon_appointment_settlements`
  - 引用校验：`appointment/location/customer/payment/sale/package/ledger` 全链路一致性
  - 状态机：`pending_payment -> {deposit_paid|fully_paid|payment_failed|payment_expired|payment_cancelled}`
  - 终态保护：禁止 terminal 直接跳 `paid`
  - RPC：
    - `apt04_upsert_appointment_settlement`
    - `pkg01_apply_appointment_package_consume`
    - `pkg01_apply_appointment_cancel_return`
    - `apt04_mark_settlement_paid`
    - `apt04_mark_settlement_terminal`
  - 触发器：
    - `apt04_on_payment_status_sync_settlement_trg`
    - `apt04_on_appointment_cancel_return_package_trg`
- `supabase/migrations/20260814233000_apt04_phase2_p1_correctness_hotfix.sql`
  - 新增原子 RPC：
    - `apt04_finalize_package_settlement`（Package consume + settlement + appointment 状态推进 同事务）
    - `apt04_prepare_online_settlement`（POS sale/item + payment + settlement 同事务）
  - `apt04_mark_settlement_paid` 增强：支付确认后推进预约 `pending -> confirmed` 并清空 `expires_at`。
  - `client_package_ledger_append_only_guard` 放宽为仅允许 `audit_log_id` 从 `null -> 非空` 的单字段回填，保持其余 append-only 约束。

### 11.3 应用层改动

- `src/lib/salon-appointments-self.ts`
  - 支持 `settlementOption` 四种路径。
  - 自助预约 create 不再依赖 `create_salon_appointment` 内部提前完成幂等；改为外层在 settlement 完成后再 `completeIdempotencyKey`。
  - 在线订金/全款先走 `apt04_prepare_online_settlement` 原子落库，再创建/复用 HitPay Payment Request。
  - 在线支付请求创建失败时，立即取消刚创建的预约（`payment_request_create_failed`），避免长期占槽。
  - Package 资格规则（本阶段保守）：同 studio + 位置匹配（package.location_id 为 null 或等于预约位置）+ package active + 未过期 + `credits_left > 0`。
- `src/app/[studioSlug]/appointments/page.tsx`
  - 新增支付方式选择 UI 与错误反馈。
  - 新增可用 Package Credits 提示。
  - Online 路径创建成功后跳转 `/[studioSlug]/checkout/[payment_id]`。
- `src/app/me/_shared/appointments-page.tsx`
  - 显示预约结算模式/状态与金额信息。
  - 对 `pending_payment` 在线支付显示 `Continue payment` 入口，避免首次跳转丢失后无法继续。
- `src/app/api/cron/expire-payments/route.ts`
  - 在支付过期清扫后补扫 `expire_pending_salon_appointments`，避免“未支付预约长期占槽”。
- `src/app/api/payment/hitpay/sync/route.ts`
  - POS 来源且 HitPay paid-like 时，走 `completePosHitpaySale`（可信支付完成链路）。

### 11.4 测试与门禁（本轮实际执行）

- `npm run test:apt04-app`
- `npm run test:apt04-db`
- `npm run test:apt02-idempotency-faults`
- `npm run test:pkg01-db`
- `npm run test:pos03-db`
- `npm run test:hitpay-merchant-mode`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

### 11.5 仍待验证 / 未关闭风险

- Deposit 仅表示订金已付，非全额结清；后续仍需在履约/收银页面补“欠款可视化与补收”完整操作链路。
- 当前无 service 级 package 适用关系模型；本轮已在 UI 与服务端统一保守规则并显式文案提示，后续需补正式 `package-service` 映射表再升级资格判断。
- 生产真实 HitPay Sandbox 与浏览器点击流证据需按发布流程补齐后，方可从“已实现/待验证”提升。

### 11.6 2026-08-14 P1 热修复闭环

- 已闭环问题：
  - 幂等键提前 completed 导致重试返回旧结构结果。
  - Package consume / online payment facts 与 settlement 非原子。
  - 支付成功后预约仍保留 `pending + expires_at`，存在误过期风险。
  - 我的预约页缺少继续支付入口。
- 新增验证：`scripts/sql/verify_apt04_phase2_settlement.sql`，覆盖 package consume/取消返还、online deposit paid 状态推进、terminal 状态防回写 paid。

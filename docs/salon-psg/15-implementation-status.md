# Salon PSG 实施状态表

更新时间：2026-08-17

本文件是开发进度的唯一来源。模块需求说明“最终产品要做什么”，Backlog 说明依赖顺序，本文件只记录每个任务当前真实状态和交付证据。

## 状态定义

- `未开始`：没有任务级实现。
- `实施中`：存在工作区改动，但范围或代码尚未完成。
- `已实现/待验证`：代码已存在，但最低测试、Migration 验证或权限矩阵证据不完整。
- `已验证/待上线`：实现和规定验证完成，但尚未进入生产版本。
- `已上线`：已进入生产版本并保留 Commit/发布证据。
- `阻塞`：缺少产品决定、外部规则或前置任务，不能安全继续。

任何任务没有任务文件和实际验证记录时，不得直接标记为“已验证”或“已上线”。

## 当前基础模块确认

| 任务 | 当前状态 | 代码确认 | 版本证据 | 仍需注意 |
|---|---|---|---|---|
| FND-01 | 已上线 | 已存在 `employees`、`employee_locations`、迁移冲突表、Studio 一致性约束、唯一用户/Instructor 关联、单一主要门店、RLS/RPC 和 `src/lib/employees.ts` | `522ef18` | 本轮只核对代码和 Commit 存在，没有重新执行历史上线测试。 |
| FND-02 | 已上线 | 已存在 `salon_customers`、迁移冲突、Merge Audit、Studio 引用校验、Guest Link/Merge RPC、RLS 和 `src/lib/salon-customers.ts` | `6ba056e` | 本轮只核对代码和 Commit 存在，没有重新执行历史上线测试。健康资料仍属于 CRM-01。 |
| FND-03 | 已上线 | 已存在 `service_locations` Migration 和 `src/lib/service-locations.ts`，包含发布范围、停用、覆盖值、审计及权限入口 | `6c40e3d`，`main` / `origin/main` | Migration 已返回 `service_location_rows_created: 47`。总部默认时长/缓冲由 APT-01 在建立 Salon Availability 契约时补充，不回退 FND-03。 |
| FND-04 | 已验证/待上线 | 已存在 `strong_audit_logs`（Append-only 强审计）、`business_idempotency_keys`（Studio-scoped Claim/Complete/Fail）、`provider_events`（Provider/Event-ID 去重）Migration 及 `src/lib/strong-audit.ts`、`idempotency.ts`、`provider-events.ts` | `75caa06`，已进入 `main` | 已修复 051 历史 dump 本地重放阻断，并在完整 migration 历史重放后通过 `test:apt02-idempotency-faults`。待发布窗口后升“已上线”。 |

详细记录见 [FND-01](./tasks/FND-01.md)、[FND-02](./tasks/FND-02.md)、[FND-03](./tasks/FND-03.md)、[FND-04](./tasks/FND-04.md)、[APT-02](./tasks/APT-02.md)。

## 全部任务状态

| 阶段 | 任务 | 状态 | 依赖 | 下一步 |
|---|---|---|---|---|
| Phase 0 | FND-01 Employee | 已上线 | 无 | 作为后续员工数据契约，不重做 |
| Phase 0 | FND-02 Customer | 已上线 | 无 | 作为后续客户数据契约，不重做 |
| Phase 0 | FND-03 Service/Location | 已上线 | FND-01 | 作为后续门店服务契约，不重做 |
| Phase 0 | FND-04 Audit/Idempotency | 已验证/待上线 | 无 | 已修复 051 历史 dump 的本地重放阻断，并在完整 migration 历史重放后通过 `test:apt02-idempotency-faults`；可供 APT-02/PKG-01/POS-01/MKT-02/PAY-02 复用 |
| Phase 1 | APT-01 Availability/Resources | 已验证/待上线 | FND-01、FND-03 | 静态门禁、resolver 与 DB rollback 已通过；专用 Free cloud UAT `apt01-availability-local` 已通过（run `32006999542`，`apt01_local_uat_ok`）。覆盖 390px Owner 写入 defaults/resource/hours，以及 Frontdesk/Instructor 配置页拒绝。历史全量覆盖传播与故障注入仍不在本批；待发布窗口后升“已上线”。 |
| Phase 1 | APT-02 Appointment Transaction | 已验证/待上线 | APT-01、FND-02、FND-04 | 已完成 APT-02 数据模型、原子 create/reschedule/cancel/expire、员工/资源冲突约束、状态历史、Terms 接受证据基础与 TS 库封装；并完成复审问题闭环（跨门店改期双门店权限、Instructor 读取收敛、幂等 claim token fencing+重放结构一致、失败状态持久化路径、改期原因落库、23P01 资源冲突映射）；`test:apt02-db-foundation`、`test:apt02-concurrency`、`test:apt02-idempotency-faults`、`npx tsc --noEmit` 通过 |
| Phase 1 | APT-03 Backoffice Calendar | 已验证/待上线 | APT-02 | DB/契约门禁已通过；专用 Free cloud UAT `apt03-calendar-local` 已通过（run `32008529292`，`apt03_local_uat_ok`）。覆盖 390px create→confirm→check-in→start→complete、Instructor 仅见本人、Frontdesk 跨门店 L2 card 拒绝。日历服务选项改为 `studio_services.title`；待发布窗口后升“已上线”。 |
| Phase 1 | CRM-01 Sensitive Customer Data | 已验证/待上线 | FND-02 | 已部署 Production；隔离 Studio 的预检、Manager/Frontdesk booking-only 允许、Instructor 直访拒绝、390px 移动端及“拒绝不写成功访问审计”均已通过。上线窗口前由业务方抽样复核真实门店 Owner/Global Manager 与动态门店关系。 |
| Phase 1 | CRM-02 Treatment/Follow-up | 已上线 | APT-03、CRM-01 | Migration、应用层与队列 UI 已部署 Production；`test:crm02-app`、`test:crm02-db`、TypeScript、ESLint 通过；生产浏览器验收覆盖 Owner、Global Manager、Location Manager、Frontdesk、Instructor、混合角色及 390px 移动端，DB 断言覆盖预约前置条件、幂等重放、审计脱敏和 follow-up queue；人工业务流验收通过 |
| Phase 1 | APT-05 Email Notifications | 已验证/待上线 | APT-03 | 已完成通知队列表、入队/claim/complete/fail/list/retry RPC、Cron Worker、后台日志与手动重试入口；`test:apt05`、`test:apt03`、`npx tsc --noEmit` 通过，等待生产窗口发布与监控接入 |
| Phase 2 | POS-01 Sale/Cart | 已验证/待上线 | FND-01、FND-02、FND-03、FND-04 | 已完成 POS sale/item 事实层、幂等写入 RPC、去收款主路径（锁单后 payment 关联）与支付进度读模型；`test:pos01-db`、`test:pos01-e2e`、`npx tsc --noEmit` 通过，待生产窗口发布 |
| Phase 2 | PKG-01 Package Ledger | 已实现/待验证 | FND-02、FND-03、FND-04、POS-01 | 目标 migration 已对齐；2 条历史正余额已完成 opening Ledger 回填且只读预检通过。已新增专用 Free cloud UAT `pkg01-package-ledger-local`（待执行）；通过后升为已验证 |
| Phase 2 | POS-02 Cash/Receipt | 已验证/待上线 | POS-01 | DB Gate、目标 migration 与 Batch 1/2 专用 Free cloud UAT 已通过（`pos02-cash-receipt-local`，run `32002949749`，`pos02_local_uat_ok`）。覆盖现金班次开启、现金收款、Sale/Payment 原子 paid、receipt number 展示、Instructor 越权拒绝与 390px。找零 UI 与 PDF/可点击收据仍不在 Batch 1/2 范围；待发布窗口后升“已上线”。 |
| Phase 2 | POS-03 HitPay | 已验证/待上线 | POS-01 | Merchant Key-only 与 Batch 2 恢复加固已落地；专用 Free cloud UAT `pos03-hitpay-sandbox-local` 已通过（run `32004577210`，`pos03_local_uat_ok`，Sandbox `api.sandbox.hit-pay.com`）。覆盖 create、pending sync、签名 webhook paid、重放幂等、无效签名 401、已付后再 sync。未在 Production 造支付数据；待发布窗口后升“已上线”。 |
| Phase 2 | PKG-02 Package Approval | 已验证/待上线 | PKG-01 | DB Gate、目标 migration 与 `pos-packages-local` Free cloud UAT 已通过（run `32003377267`，`pos_pkg_local_uat_ok`）。覆盖 390px draft/submit、并发 checker 批准单一转换、Ledger apply、拒绝路径与 Instructor 拒绝访问；待发布窗口后升“已上线”。 |
| Phase 2 | APT-04 Self Booking | 已实现/待验证（Phase 2） | 启动：APT-03、CRM-01；上线：PKG-01、POS-03 | 已接入 Package Credits、在线订金与在线全款；新增预约级 settlement 主记录、Package consume/cancel_return Ledger 链路、支付链路校验与状态机保护。已补 2026-08-14 P1 热修复：幂等完成时机后移、Package/online 事实原子化、paid 后预约推进并清空 expires_at、继续支付入口与预约过期补扫。`test:apt04-app`、`test:apt04-db`、`test:apt02-idempotency-faults`、`test:pkg01-db`、`test:pos03-db`、`test:hitpay-merchant-mode`、`lint`、`tsc`、`build` 通过。真实生产支付点击流与发布证据待补，不标记“已上线”。 |
| Phase 2 | COM-01 Commission | 已上线 | POS-02、POS-03、CRM-02 | 生产 Migration 与应用已发布；`test:com01-db`、真实 HitPay Sandbox 支付/退款、隔离本地 Supabase UAT、角色/交易最终状态浏览器断言和 DB 只读证据均通过（`RUN_ID=COM01-UAT-LOCAL-V2-20260814-182536`）；未在 Production 造测试财务数据 |
| Phase 2 | POS-04 Refund/Void/Close | 已验证/待上线（Batch 1/2/3 已完成） | COM-01、PKG-01 | 2026-08-16 已在隔离 Docker/Postgres 重跑 `test:pos04-db`（部分退款、现金班次、RPC 幂等均通过）；隔离本地 COM-01 浏览器 UAT 已真实提交全额退款与关班表单，并核验佣金反向分录、现金差异、审计和最终页面。浏览器 UAT 不会隐式回退生产；Void 继续由既有 DB/action Gate 覆盖，未新增 Void 点击证据。待发布窗口及目标环境发布证据。 |
| Phase 3 | MKT-01 Audience/Email | 已验证/待上线 | FND-02、CRM-01、POS-04 | 已发布 Consent/Suppression、Audience Snapshot、固定 Email Builder、测试邮件和一键退订；专用隔离本地 UAT 已通过 |
| Phase 3 | MKT-02 Dispatch/Report | 已实现/待目标环境验证 | MKT-01、FND-04 | 已完成立即/预约发送、幂等分批 Cron、Resend 签名 Webhook、退避重试、Bounce/Complaint Suppression、CTA 点击和 Campaign 报告；本地 DB 契约、TypeScript、ESLint 与隔离浏览器回归通过，待目标环境配置真实 Resend Webhook 并留存送达证据 |
| Phase 3 | PAY-01 Compensation/Rules | 未开始 | FND-01、COM-01、专业规则 | 等待依赖及 Payroll 规则签字 |
| Phase 3 | PAY-02 Payroll Run | 未开始 | PAY-01 | 等待依赖 |
| Phase 3 | PAY-03 Payslip/Reports | 未开始 | PAY-02 | 等待依赖 |
| Phase 4 | RPT-01 Reporting Facts | 未开始 | APT-03、POS-04、COM-01、PKG-01 | 等待稳定业务事实 |
| Phase 4 | RPT-02 Dashboard | 未开始 | RPT-01 | 等待依赖 |
| Phase 4 | EXP-01 Exports | 未开始 | RPT-01、CRM-02、POS-04、PKG-02、PAY-03 | 等待依赖 |
| Phase 4 | CMP-01 PDPA Controls | 未开始 | CRM-01、FND-04 | 产品开发后由负责人完成表格 |
| Phase 4 | SEC-01 VA/PT | 未开始 | 全部 Yes 功能稳定 | 提前询价，稳定后测试 |
| Phase 4 | ORG-01 Certification | 未开始 | 申请主体确认 | 公司负责人推进 |
| Phase 4 | PSG-01 Evidence/Demo | 未开始 | 全部 Yes、EXP、CMP、SEC | 最终收口 |

## 2026-08-12 验收收口（APT-05 / POS-01 / PKG-01 依赖契约冻结）

本轮在 `codex/salon-foundation-acceptance` 执行基础模块收口验证，目标是冻结下游任务依赖契约（不在本轮开发 APT-05、POS 或 Package）：

- FND-04：
  - 远端/本地 Migration 一致性：`supabase migration list` 返回本地与远端全量对齐（含 `20260811140130`、`20260812102000`、`20260812132000`）。
  - Legacy 051 阻断复核：`supabase start` 仍在 `051_member_profile_notes.sql` 的 `\restrict` 语法处报 `42601`，阻断仍真实存在（非过期结论）。
  - 合同验证：最小 Postgres 沙盒复测 `strong_audit_logs` append-only、`business_idempotency_keys` claim/replay/stale fencing、`provider_events` dedup/payload_conflict，结果 `fnd04_acceptance_ok`。
  - 复用性验证：`test:apt02-idempotency-faults`、`test:crm01-db`、`test:crm02-db` 均通过，说明 Appointment/CRM 已稳定复用同一幂等与强审计原语。
- APT-01：`test:apt01-static-gates`、`test:availability`、`test:apt01-db-rollback` 通过，确认跨 Studio/Location 资源与可用性核心契约可回归。2026-08-17 已用 `apt01-availability-local` Free cloud UAT 补 390px 与角色拒绝证据。
- APT-03：`test:apt03-app` + `test:apt03-db` 通过，覆盖日/周视图查询契约、状态转换、资源释放、幂等重放与越权拒绝。2026-08-17 已用 `apt03-calendar-local` Free cloud UAT 补 390px 日历主路径与跨门店拒绝证据。
- CRM-01：`test:crm01-app`、`test:crm01-static`、`test:crm01-db` 通过；`verify:crm01-preflight` 受缺失 `CRM01_E2E_STUDIO_ID` 限制未完成专属隔离门店预检。生产侧补充执行 `test:crm02-browser`（固定账号 + 390px）通过，角色矩阵、越权拒绝、审计脱敏与幂等重放均通过。

冻结结论（供下游直接依赖）：

- APT-05 允许直接依赖：APT-03 状态迁移与幂等重放契约（通知侧不得改写 Appointment 原子状态机）。
- POS-01 允许直接依赖：FND-04 的强审计 + idempotency + provider event 去重契约（Sale/Payment 必须沿用 Claim/Complete/Fail fencing）。
- PKG-01 允许直接依赖：FND-04 与 POS-01 销售事实的不可变审计与幂等契约（Ledger 不得引入第二套幂等/审计机制）。

未完成项（不阻断契约冻结，但阻断“全部真实环境验收完成”）：

- `CRM01_E2E_STUDIO_ID` 对应隔离门店预检尚未补齐。
- APT-01 与 APT-03 的隔离 390px / 角色矩阵浏览器证据已于 2026-08-17 由 Free cloud UAT 收口；生产发布窗口证据仍待补，不升“已上线”。

## 当前建议领取顺序

1. Phase 1 浏览器证据缺口（APT-01 / APT-03）已用隔离 Free cloud UAT 收口。进入 Phase 3 前仍需生产发布窗口，才能把 APT-02/05、CRM-01、POS-02/03、PKG-02、POS-04 等“已验证/待上线”升为“已上线”。
2. 下一开发项优先 PKG-01（仍为已实现/待验证：专用事务点击流）。APT-04 / MKT-02 继续按依赖窗口补目标环境证据；支付相关验证只用 HitPay Sandbox。

## 2026-08-17 状态更新（POS-02 Cash/Receipt UAT）

- 已新增并接入 `pos02-cash-receipt-local`（fixture、浏览器 verifier、Free cloud UAT / changed-path / release-gate 目录）。
- GitHub Actions Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32002949749（`pos02_local_uat_ok`）。
- POS-02 Batch 1/2 升为“已验证/待上线”；找零 UI 与 PDF/可点击收据仍明确不在本批范围。

## 2026-08-17 状态更新（PKG-02 Package Approval UAT）

- GitHub Actions Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32003377267（`pos_pkg_local_uat_ok`）。
- 覆盖 draft、submit、并发 approval 单一转换、Ledger apply、reject、390px 与越权拒绝。
- PKG-02 升为“已验证/待上线”；待发布窗口和目标环境证据。

## 2026-08-17 状态更新（POS-03 HitPay Sandbox UAT）

- 已新增并接入 `pos03-hitpay-sandbox-local`（fixture、浏览器 verifier、Free cloud UAT / changed-path / release-gate 目录；GitHub secrets `POS03_HITPAY_API_KEY` / `POS03_HITPAY_WEBHOOK_SALT`）。
- GitHub Actions Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32004577210（`pos03_local_uat_ok`，`HITPAY_API_BASE_URL=https://api.sandbox.hit-pay.com`）。
- 覆盖 create、pending sync、签名 webhook 完成 paid、重放幂等、无效签名 401、已付后再 sync。
- POS-03 Batch 1/2 升为“已验证/待上线”；未使用 Production HitPay / Production 财务测试数据。

## 2026-08-17 状态更新（APT-01 / APT-03 Phase 1 浏览器证据）

- 已新增并接入 `apt01-availability-local` 与 `apt03-calendar-local`（fixture、浏览器 verifier、Free cloud UAT / changed-path / release-gate 目录）。
- APT-01 Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32006999542（`apt01_local_uat_ok`）。
- APT-03 Free cloud UAT 通过：https://github.com/xucheng2024/studio/actions/runs/32008529292（`apt03_local_uat_ok`）。
- 日历创建表单改为读取 `studio_services.title`。两项均升为“已验证/待上线”；不升“已上线”（待发布窗口）。

## 2026-08-14 状态更新（COM-01）

- COM-01 已实现数据库主链路：佣金规则版本、earned/reversal append-only 分录、walk-in `fulfilled_at` 审计证据、唯一来源与退款检查点去重。
- 已新增并通过独立 DB runner：`npm run test:com01-db`（覆盖先付后做、先做后付、未完成/未付款不入账、重放幂等、越权拒绝、部分+全额退款反向 Entry、HitPay/Cash 并发竞争、无 payment 先 fulfill 后支付回归）。
- 本地 Supabase 事务 UAT 已通过：四类顺序、退款反向、幂等与越权 SQL Gate 均通过（`RUN_ID=COM01-UAT-LOCAL-20260814-155653`）。
- 本地代码门禁通过：`npm run lint`、`npx tsc --noEmit`、`npm run build`。
- COM-01 DB Gate 结论：已闭环，无新增阻断。
- COM-01 生产 Migration/应用已发布，并完成新一轮隔离本地 UAT（`RUN_ID=COM01-UAT-LOCAL-V2-20260814-182536`）：SQL 事务场景、DB 证据、角色权限与最终页面断言全部通过，新生成 10 张非 Loading/Skeleton 截图。
- COM-01 正式升为“已上线”；验收未在 Production 造测试财务数据，生产发布证据与隔离 UAT 证据分开保留。
- COM-01 剩余两项业务口径已冻结：无生效规则视为不适用佣金（0）且不阻断收款/不自动追溯；百分比佣金基数为 `pos_sale_items.total_amount`，退款按比例追加反向 Entry。现有实现已符合，无需新增生产 Migration。

## 2026-08-14 状态更新（POS-04 Batch 3）

- POS-04 已完成 Batch 1/2/3 代码与验证闭环，新增 cash session migration、DB 验证脚本、Payments 联动筛选、POS/Payments 顶部班次状态提示与 Runbook SOP。
- 代码与文档已推送 `main`：`11501b1`、`7e67600`、`ba5498e`。
- 本文件已同步 POS-02/POS-03/POS-04 真实状态，后续以发布验证结果决定是否升为“已上线”。

## 2026-08-14 计划一致性复核

- `main` 与 `origin/main` 已对齐，工作区复核开始时无未提交改动。
- PKG-01 与 PKG-02 已有 Migration、应用入口、验证脚本和 Commit，原“未开始”状态属于进度文档滞后，现校正为“已实现/待验证”。
- POS-02/POS-03 的核心实现与 DB 验证已通过，原“开发中”状态已校正；真实 HitPay/Cash 浏览器 UAT 与目标环境证据仍未补齐。
- POS-04 虽已完成三个开发批次，但当前全量 ESLint 因 `dashboard/pos/cash-sessions/page.tsx` 渲染期调用 `Date.now()` 失败，且 `package.json` 缺少统一 `test:pos04-db` 入口，因此从“已验证/待上线”校正为“已实现/待验证”。
- 本次复核通过：`next build`、`npx tsc --noEmit`、PKG-01 DB、PKG-02 DB、POS-02 DB、POS-03 DB、Exports/APT-03/CRM-01/CRM-02 应用契约测试。PKG-02 首次紧接 PKG-01 执行时遇到临时 Postgres 连接退出，独立重跑通过；不计为产品失败，但后续应让 DB runner 具备可靠的连续执行能力。

## 2026-08-14 POS / Package 联合验收更新

- 已修复 Cash Session render 期 `Date.now()` ESLint 失败，新增 `test:pos04-db`，并统一 POS-02/03/04、PKG-01/02 runner 的 PostgreSQL 最终就绪判断；连续执行稳定通过。
- 远端 migration 全量对齐；PKG-01 opening balance dry-run 后正式回填 2 条，冲突为 0，回填后目标只读预检通过。
- Production 浏览器权限矩阵覆盖 Owner、Global Manager、Location Manager、Frontdesk、Instructor；POS、Cash Session、Package Approval 允许/拒绝符合预期，Owner 390px 回归通过。
- 真实 HitPay Sandbox 与事务点击流仍按验收报告中的 Gate 保留。完整证据见 [POS / Package 联合验收](./releases/2026-08-14-pos-pkg-joint-acceptance.md)。
- `e3c0932` 已推送并部署至 Vercel Production（`dpl_F6UeLQpKUCQA7NATcqtvjasZAFdS`）；部署后 route smoke、目标预检、migration 对齐和完整浏览器权限矩阵再次通过。

## 2026-08-14 状态更新（APT-04 Phase 1）

- APT-04 Phase 1 已完成：`/{studioSlug}/appointments`（登录客户实时档期 + 本人预约创建）、`/{studioSlug}/me/appointments` 与 `/me/appointments`（本人查看/改期/取消）。
- DB 已新增 customer actor guard（`20260814193000_apt04_customer_self_booking_actor.sql`）：customer 仅能操作本人 `salon_customer/appointment`，并继续复用 APT-02 原子 RPC 与 FND-04 幂等链路。
- 新增 APT-04 专项验证：`test:apt04-app`、`test:apt04-db`。
- 相关回归与门禁已通过：`test:apt02-db-foundation`、`test:apt02-concurrency`、`test:apt02-idempotency-faults`、`test:apt03`、`test:crm01-app`、`test:crm01-static`、`test:crm01-db`、`lint`、`tsc`、`build`。
- 为消除 Docker PostgreSQL 启动竞态，已统一加固 `verify-apt02-*` 与 `verify-crm01-db` 的数据库最终就绪判定（双 ready 日志 + SQL ping）。
- Phase 1 已标记为“可验收”；真实 Safari/真实 390px 设备补证由业务方接受为非阻断剩余风险。Package/订金/全款接入保持第二阶段范围。

## 2026-08-14 状态更新（APT-04 Phase 1 复核修复）

- 针对复核发现的 6 项问题已完成修复：
  - Server Actions 执行时重认证当前会话身份，不再复用渲染时 user 快照。
  - 幂等 claim 在 RPC 业务失败时也会释放，避免 `idempotency_in_progress` 卡死。
  - 改期默认 idempotency key 包含新时间，失败后改选时间不触发 hash 冲突。
  - `/me/appointments` 支持跨 Studio 聚合查看，并在有 active studio 时可重定向到对应管理页。
  - 改期/取消后的 `ok/error` 结果可见，页面不再“静默刷新”。
  - 档期边界计算纳入 prep/buffer，避免展示提交即失败的首末档。
- 本轮复核门禁通过：`test:apt04-app`、`test:apt04-db`、`test:apt03`、`test:apt02-idempotency-faults`、`test:pos03-db`、`test:pkg01-db`、`test:hitpay-merchant-mode`、`lint`、`tsc`、`build`。
- 验收决策更新：业务方接受真实 Safari 与真实 390px 设备未补证的剩余风险，APT-04 Phase 1 升为“可验收”，但不标记“已上线”。
- 已补 APT-04 浏览器验收执行资产：`docs/salon-psg/releases/2026-08-14-apt04-phase1-browser-acceptance-checklist.md`（含 390px + 多浏览器清单与证据模板），可直接用于 Phase 1 最终验收留档。
- 隔离 UAT `APT04-UAT-LOCAL-20260814-2350` 已通过真实 Chrome 完整链路、Firefox/WebKit 关键链路与 390px viewport 预检，并关闭真实 schema/幂等重订/active Studio/移动端溢出问题；未补的真实 Safari 与真实 390px 设备证据记录为已接受风险，不阻断 Phase 1 验收。

## 2026-08-17 远端 Migration 对齐（APT-04 / POS-03）

- 已在链接的 Studio Supabase 项目应用 5 个此前待迁移版本：`20260814193000`、`20260814203000`、`20260814220000`、`20260814233000` 与 `20260817120000`。
- `supabase migration list` 已确认上述版本的本地与远端记录一致。
- `20260817120000_pos03_hitpay_recovery_hardening.sql` 已启用 HitPay webhook 异常记录的 RLS/服务端最小权限，并收紧主动同步、webhook 及 provider-event 完成失败的恢复语义。
- 本轮未对 Production 创建支付、退款或预约测试数据；远端 Migration 对齐不等同于 POS-03 的真实 Sandbox 恢复验收或完整应用发布证据。

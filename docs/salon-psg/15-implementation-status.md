# Salon PSG 实施状态表

更新时间：2026-08-14

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
| FND-04 | 已实现/待验证 | 已存在 `strong_audit_logs`（Append-only 强审计）、`business_idempotency_keys`（Studio-scoped Claim/Complete/Fail）、`provider_events`（Provider/Event-ID 去重）Migration 及 `src/lib/strong-audit.ts`、`idempotency.ts`、`provider-events.ts` | `75caa06`，已进入 `main` | 验证使用独立最小 Postgres 沙盒完成（详见 [FND-04](./tasks/FND-04.md)），因既有 `051_member_profile_notes.sql` 的 `\restrict` 语法及 `auth` Schema 权限问题（与本任务无关）暂无法从空库完整重放历史；`operation_audits` 未做 Schema 变更或回填，仅在任务文件中给出未解决 Legacy 记录的报告查询。 |

详细记录见 [FND-01](./tasks/FND-01.md)、[FND-02](./tasks/FND-02.md)、[FND-03](./tasks/FND-03.md)、[FND-04](./tasks/FND-04.md)、[APT-02](./tasks/APT-02.md)。

## 全部任务状态

| 阶段 | 任务 | 状态 | 依赖 | 下一步 |
|---|---|---|---|---|
| Phase 0 | FND-01 Employee | 已上线 | 无 | 作为后续员工数据契约，不重做 |
| Phase 0 | FND-02 Customer | 已上线 | 无 | 作为后续客户数据契约，不重做 |
| Phase 0 | FND-03 Service/Location | 已上线 | FND-01 | 作为后续门店服务契约，不重做 |
| Phase 0 | FND-04 Audit/Idempotency | 已实现/待验证 | 无 | 修复 051 既有 Migration 问题后对完整历史重跑一次回归；之后可供 APT-02/PKG-01/POS-01/MKT-02/PAY-02 复用 |
| Phase 1 | APT-01 Availability/Resources | 已实现/待验证 | FND-01、FND-03 | 已补批量原子 RPC、资源跨门店 strict guard、DB 侧 exception 归属校验、联合可用性接口、资源编辑 UI；新增静态门禁脚本、resolver 回归脚本、数据库回滚脚本（`postgres:15`）通过，`next build` 通过；待补真实环境角色矩阵/动态越权/移动端回归后可升为已验证 |
| Phase 1 | APT-02 Appointment Transaction | 已验证/待上线 | APT-01、FND-02、FND-04 | 已完成 APT-02 数据模型、原子 create/reschedule/cancel/expire、员工/资源冲突约束、状态历史、Terms 接受证据基础与 TS 库封装；并完成复审问题闭环（跨门店改期双门店权限、Instructor 读取收敛、幂等 claim token fencing+重放结构一致、失败状态持久化路径、改期原因落库、23P01 资源冲突映射）；`test:apt02-db-foundation`、`test:apt02-concurrency`、`test:apt02-idempotency-faults`、`npx tsc --noEmit` 通过 |
| Phase 1 | APT-03 Backoffice Calendar | 已实现/待验证 | APT-02 | 已完成 APT-03 migration（日/周日历查询 + 状态转换 RPC + 资源释放 + 幂等 fencing + history/audit）、`src/lib/salon-appointments.ts` 新增 calendar/transition 封装、`/dashboard/appointments` 日/周视图与 create/confirm/check-in/start/complete/reschedule/cancel/no-show 操作；`npm run test:apt03-db`（含 cancelled payload 重放一致性）、`npm run test:apt03-app`（TS 契约+多门店聚合+周窗口单测）、`npx tsc --noEmit`、任务相关 ESLint 已通过，待补真实环境角色矩阵/移动端/浏览器端手工回归后升为已验证 |
| Phase 1 | CRM-01 Sensitive Customer Data | 已验证/待上线 | FND-02 | 已部署 Production；隔离 Studio 的预检、Manager/Frontdesk booking-only 允许、Instructor 直访拒绝、390px 移动端及“拒绝不写成功访问审计”均已通过。上线窗口前由业务方抽样复核真实门店 Owner/Global Manager 与动态门店关系。 |
| Phase 1 | CRM-02 Treatment/Follow-up | 已上线 | APT-03、CRM-01 | Migration、应用层与队列 UI 已部署 Production；`test:crm02-app`、`test:crm02-db`、TypeScript、ESLint 通过；生产浏览器验收覆盖 Owner、Global Manager、Location Manager、Frontdesk、Instructor、混合角色及 390px 移动端，DB 断言覆盖预约前置条件、幂等重放、审计脱敏和 follow-up queue；人工业务流验收通过 |
| Phase 1 | APT-05 Email Notifications | 已验证/待上线 | APT-03 | 已完成通知队列表、入队/claim/complete/fail/list/retry RPC、Cron Worker、后台日志与手动重试入口；`test:apt05`、`test:apt03`、`npx tsc --noEmit` 通过，等待生产窗口发布与监控接入 |
| Phase 2 | POS-01 Sale/Cart | 已验证/待上线 | FND-01、FND-02、FND-03、FND-04 | 已完成 POS sale/item 事实层、幂等写入 RPC、去收款主路径（锁单后 payment 关联）与支付进度读模型；`test:pos01-db`、`test:pos01-e2e`、`npx tsc --noEmit` 通过，待生产窗口发布 |
| Phase 2 | PKG-01 Package Ledger | 已实现/待验证 | FND-02、FND-03、FND-04、POS-01 | 目标 migration 已对齐；2 条历史正余额已完成 opening Ledger 回填且只读预检通过。待部署本轮门禁修复，并补专用事务点击流后升为已验证 |
| Phase 2 | POS-02 Cash/Receipt | 已实现/待验证 | POS-01 | DB Gate、目标 migration、角色/390px 浏览器 Gate 已通过；待专用 UAT fixture 完成现金收款、找零和收据点击流 |
| Phase 2 | POS-03 HitPay | 已实现/待验证 | POS-01 | DB Gate、目标 migration、角色浏览器 Gate 已通过；隔离 UAT Studio 缺 Sandbox merchant key/webhook salt，真实支付、签名重放、主动同步与异常恢复仍阻塞 |
| Phase 2 | PKG-02 Package Approval | 已实现/待验证 | PKG-01 | DB Gate、目标 migration、maker/checker 角色矩阵、390px 与目标只读异常检查通过；待专用 UAT fixture 完成申请/批准/拒绝/并发点击流 |
| Phase 2 | APT-04 Self Booking | 未开始 | 启动：APT-03、CRM-01；上线：PKG-01、POS-03 | 可先开发登录/实时档期/本人改期取消，最终接入 Package、订金和全款 |
| Phase 2 | COM-01 Commission | 未开始 | POS-02、POS-03、CRM-02 | 等待依赖 |
| Phase 2 | POS-04 Refund/Void/Close | 已实现/待验证（Batch 1/2/3 已完成） | COM-01、PKG-01 | ESLint 与统一 `test:pos04-db` 已恢复，目标 migration、角色/390px Gate 通过；待专用退款/日结点击流，COM-01 完成后补佣金反向事实联合 Gate |
| Phase 3 | MKT-01 Audience/Email | 未开始 | FND-02、CRM-01、POS-04 | 等待依赖 |
| Phase 3 | MKT-02 Dispatch/Report | 未开始 | MKT-01、FND-04 | 等待依赖 |
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
- APT-01：`test:apt01-static-gates`、`test:availability`、`test:apt01-db-rollback` 通过，确认跨 Studio/Location 资源与可用性核心契约可回归；动态浏览器矩阵与 390px 手工回归仍需上线窗口补证。
- APT-03：`test:apt03-app` + `test:apt03-db` 通过，覆盖日/周视图查询契约、状态转换、资源释放、幂等重放与越权拒绝；390px 浏览器手工回归仍需上线窗口补证。
- CRM-01：`test:crm01-app`、`test:crm01-static`、`test:crm01-db` 通过；`verify:crm01-preflight` 受缺失 `CRM01_E2E_STUDIO_ID` 限制未完成专属隔离门店预检。生产侧补充执行 `test:crm02-browser`（固定账号 + 390px）通过，角色矩阵、越权拒绝、审计脱敏与幂等重放均通过。

冻结结论（供下游直接依赖）：

- APT-05 允许直接依赖：APT-03 状态迁移与幂等重放契约（通知侧不得改写 Appointment 原子状态机）。
- POS-01 允许直接依赖：FND-04 的强审计 + idempotency + provider event 去重契约（Sale/Payment 必须沿用 Claim/Complete/Fail fencing）。
- PKG-01 允许直接依赖：FND-04 与 POS-01 销售事实的不可变审计与幂等契约（Ledger 不得引入第二套幂等/审计机制）。

未完成项（不阻断契约冻结，但阻断“全部真实环境验收完成”）：

- `CRM01_E2E_STUDIO_ID` 对应隔离门店预检尚未补齐。
- APT-01 与 APT-03 的 390px 端到端浏览器手工证据需在上线窗口补档。

## 当前建议领取顺序

1. 为隔离 UAT Studio 配置 HitPay Sandbox merchant key/webhook salt，完成 POS-03 真实支付 Gate；不得使用真实商户生产配置制造测试支付。
2. 在独立 Staging/UAT Project（或经业务批准的专用 Production fixture）补 Cash/Receipt、Refund/Cash Session、Package Approval 的事务点击流。
3. 领取 COM-01，建立唯一佣金事实及退款反向 Entry；这是 POS-04 最终 Gate、Payroll 和 Reporting 的关键路径。
4. APT-04 保持“先可用后结算”策略，并在进入 Phase 3 前补齐 Phase 1 证据缺口。

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

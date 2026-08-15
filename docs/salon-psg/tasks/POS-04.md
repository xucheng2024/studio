# POS-04：退款 / 作废 / 日结（Batch 1 + Batch 2 + Batch 3）

状态：已实现/待验证（Batch 1/2/3 已落地；Lint 与统一 DB runner 已恢复，待事务 UAT 与 COM-01 联合 Gate）

负责人：Codex

开始日期：2026-08-13

## 1. 目标

先落地 POS-04 的最小可上线闭环（不阻塞现有 POS-01/02/03）：

- 对未付款 POS 单提供受控 `void` 能力（只允许 `draft` / `pending_payment`）
- 对已付款 POS 单提供最小退款入口（先整单退款，后续扩展到明细/部分退款）
- 所有退款/作废动作进入强审计与幂等栅栏
- 给前台/运营明确 SOP，避免“手工改状态”

## 2. 本批范围（Batch 1）

- 数据库：`void_pos_sale` 事务 RPC（含状态机约束、门店隔离、审计）
- 应用层：Dashboard POS 明细页 `Void sale` 入口（仅未付款可见）
- 退款最小入口：复用现有 payment refund 流程，串联 POS sale 状态回写（先整单）
- 可观测：记录 `void_pos_sale_failed` / `refund_pos_sale_failed` 异常事件
- 文档：1 页运行手册（“应收未收取消单 / 已收款退款”）

## 3. 本批不做（Batch 1）

- 明细/部分退款金额分摊（后续 Batch）
- Package 反向 Ledger 与 Commission 反向 Entry（依赖 PKG-01 / COM-01）
- Cash Session / 日结总账页面（后续 Batch）
- Credit Note 正式编号策略（后续 Batch）

## 4. 验收标准（Batch 1）

- 仅 `draft` / `pending_payment` POS 单可作废，`paid` 单作废被拒绝
- 作废成功后，相关支付记录与销售状态保持一致，不出现“孤儿状态”
- 退款触发后，POS sale 与 payment 状态一致推进到 `refunded` 或 `partially_refunded`
- 同 idempotency key 重放不重复执行
- `npx tsc --noEmit` 与相关 DB 脚本通过

## 5. 开发顺序（Batch 1 建议）

1. 先做 `void_pos_sale`（风险低、依赖少）
2. 再接 POS 明细页 `Void sale` 按钮
3. 再做整单退款串联与回写
4. 最后补异常看板与 runbook

## 6. Batch 2（退款明细化，已落地）

- 数据库事务 RPC：`refund_pos_sale_items`
  - 支持按 sale item 退款（数量 / 金额）
  - 约束单项与整单退款上限，避免溢出
  - 状态推进：`paid -> partially_refunded / refunded`
- 状态同步：`sync_pos_sale_refund_status`
  - 在 payment refund 后回写 POS 销售状态与 `refunded_amount`
- 迁移文件：
  - `supabase/migrations/20260813180000_pos04_refund_items_rpc.sql`
  - `supabase/migrations/20260813145500_pos04_sync_sale_refund_status.sql`

## 7. Batch 3（日结 / Cash Session）已落地

目标：建立“开班 → 收款归集 → 关班对账 → 差异审计”的现金日结闭环，确保前台现金与 POS 现金交易可追溯、可复盘、不可静默篡改。

### 7.1 范围（In Scope）

- Cash Session 主流程：
  - 开班 `open_pos_cash_session`
  - 关班 `close_pos_cash_session`
  - 查询 `get_pos_cash_session_summary`
- POS 现金单归集：
  - `complete_pos_cash_sale` 成功后自动归集到当前 open session
  - 现金退款（已退款路径）计入 `cash_out`
- 日结字段：
  - `opening_float`
  - `cash_in`
  - `cash_out`（含退款）
  - `expected_cash`
  - `counted_cash`
  - `cash_over_short`
- Dashboard：
  - Cash Session 列表页（按门店、日期、状态）
  - Cash Session 明细页（交易明细 + 差异）
  - POS/Payments 页面增加“当前收银班次状态”提示
- 强审计与幂等：
  - 开班/关班动作进入 `record_strong_audit`
  - 开班与关班 RPC 均要求 `idempotency_key + request_hash`

### 7.2 非范围（Out of Scope）

- Accounting GL/总账分录输出
- 跨币种现金管理
- 复杂审批流（如双人复核强制）
- 历史 legacy payment 自动回补到旧班次

### 7.3 数据与数据库改动

- 新增表：`pos_cash_sessions`
  - 核心字段：
    - `id`, `studio_id`, `location_id`
    - `opened_by`, `opened_at`, `opening_float`
    - `closed_by`, `closed_at`, `counted_cash`
    - `cash_in`, `cash_out`, `expected_cash`, `cash_over_short`
    - `status`（`open` / `closed` / `voided`）
    - `notes`, `created_at`, `updated_at`
- `payments` 增量字段：`cash_session_id uuid null`
  - 仅 `payment_method = 'cash'` 且 `source = 'pos_sale'` 允许写入
- 约束与索引：
  - 同一 `location_id` 同时仅允许一个 `open` session（唯一部分索引）
  - `cash_over_short = counted_cash - expected_cash`
  - `payments(studio_id, cash_session_id, status, paid_at)` 组合索引

### 7.4 RPC 设计

- `open_pos_cash_session(...)`
  - 校验 actor scope（门店权限）
  - 拒绝重复开班（同门店已有 open session）
  - 返回 session 快照（含 `opening_float`）
- `close_pos_cash_session(...)`
  - 锁定 session 与关联 cash payments
  - 计算 `cash_in / cash_out / expected_cash`
  - 写入 `counted_cash` 与 `cash_over_short`
  - 状态推进到 `closed`
- `attach_payment_to_open_cash_session(...)`（可内联到现有 complete cash 流程）
  - 将新确认的现金 payment 绑定到当前 open session
  - 无 open session 时可配置：
    - 严格模式：拒绝完成现金收款
    - 兼容模式：允许完成并打 `unassigned_cash_payment` 异常事件

### 7.5 应用层改动

- Server Actions：
  - `openPosCashSessionAction`
  - `closePosCashSessionAction`
- 页面：
  - `/dashboard/pos/cash-sessions`
  - `/dashboard/pos/cash-sessions/[sessionId]`
- POS 明细页：
  - 展示该销售归属 `cash_session_id`
  - 若门店无 open session，`Mark as paid (cash)` 显示阻断文案（严格模式）
- Payments 页面：
  - 新增筛选 `cash_session_id` / `unassigned_cash`

### 7.6 权限与门店隔离

- `owner` / `manager`：开班、关班、查看全部授权门店班次
- `frontdesk`：仅可在授权门店开/关本人班次（或按策略仅开班）
- 所有查询与写入必须同时满足 `studio_id + location_id` 作用域检查

### 7.7 验收标准（Batch 3）

- 每门店同一时刻最多一个 open cash session
- 现金 POS 收款可稳定归集到 open session，不出现孤儿 payment
- 关班后 `expected_cash` 与明细汇总一致
- `cash_over_short` 计算正确且可审计
- RPC 重放不重复开班/关班
- `npx tsc --noEmit` 与新增 DB 验证脚本通过

### 7.8 开发顺序（Batch 3，已完成）

1. 先上 DB migration（`pos_cash_sessions` + `payments.cash_session_id` + 约束/索引）
2. 实现 `open_pos_cash_session` / `close_pos_cash_session` RPC
3. 接入 `complete_pos_cash_sale` 的 session 绑定
4. 开发 Dashboard list/detail 页面
5. 补强异常看板、Runbook 与 DB 验证脚本

### 7.9 风险与决策点（已决策）

- 无 open session 时现金收款策略：严格阻断 vs 兼容放行
- `frontdesk` 是否允许关闭“非本人开启”的班次
- 关班后是否允许补录 `counted_cash`（建议不允许，仅可新建差异说明）
- 与 COM-01 / PKG-01 的退款反向分录保持时序一致（避免关班后再改当班现金）

## 8. Batch 3 完成清单（2026-08-14）

- SQL migration 已提交并推送：
  - `supabase/migrations/20260813193000_pos04_cash_sessions_foundation.sql`
  - `supabase/migrations/20260813194500_pos04_cash_session_open_close_rpcs.sql`
  - `supabase/migrations/20260813200000_pos04_bind_cash_sale_to_session.sql`
- DB 验证脚本：
  - `scripts/sql/verify_pos04_cash_sessions.sql`
- 应用层：
  - Cash Session 列表/详情页已上线代码路径
  - Payments 页面已补 `cash_session_id / unassigned_cash` 筛选与异常提示卡
  - POS / Payments 顶部已补“当前门店 open cash session 状态”提示
  - POS Runbook 已更新“开班 → 收款 → 关班 → 差异处理”SOP

## 9. 2026-08-16 验证与 UAT 目标门禁

- 已在隔离 Docker/Postgres 环境重跑 `npm run test:pos04-db`，通过：
  - `pos04_partial_refund_ok`
  - `pos04_cash_sessions_ok`
- 已将 `scripts/verify-pos-pkg-browser.mjs` 改为不再隐式回退到生产站点：
  - 必须显式提供 `POS_PKG_BASE_URL`。
  - 非 `localhost` / `127.0.0.1` 的目标还必须明确设置 `POS_PKG_ALLOW_REMOTE_UAT=1`。
  - 因此常规本地开发或验证不会意外触发生产浏览器 UAT。
- 已新增 `test:pos-pkg-browser-guard`，覆盖缺失目标与未授权远端目标拒绝；并已运行 ESLint 与 `git diff --check`，通过。
- 已扩展隔离 `verify-com01-uat-browser-local.mjs`，并通过新的 `$uat-browser` flow runner 完成完整本地 UAT（报告：`tmp/uat-browser/com01-commission-local-clicks-20260816-v8/flow-report.json`）：
  - SQL fixture 仅准备已付款、已履约、未退款的现金销售；浏览器以 Owner 身份提交全额退款表单。
  - UAT 在点击后核验 Sale/Item/Payment 退款事实、原 Cash Session 关联、COM-01 earned + `refund_reversal` 净额归零，以及 `pos_sale_items_refunded` 审计。
  - 浏览器随后在同一 Cash Session 提交关班；UAT 核验 `opening_float=200`、`cash_in=200`、`cash_out=100`、`expected_cash=300`、`counted_cash=305`、`cash_over_short=5`、关班人/时间与 `pos_cash_session_closed` 审计，并断言最终页面金额。
  - 所有目标均为 loopback 本地 Supabase/Next；运行器完成后自动清理临时服务，没有远端或生产回退。
- 退款/日结浏览器事务点击流与 COM-01 佣金反向事实联合 Gate 已关闭，任务升为“已验证/待上线”。`Void` 未在本轮新增浏览器点击证据，继续由既有 DB/action Gate 覆盖；不得将其表述为本轮浏览器覆盖。

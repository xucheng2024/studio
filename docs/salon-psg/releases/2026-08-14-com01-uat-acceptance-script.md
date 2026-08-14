# 2026-08-14 COM-01 目标 UAT 验收脚本（事务浏览器 + DB 证据）

> 适用范围：COM-01 Commission。仅用于**隔离 UAT 环境**，不得在 Production 造财务测试数据。

## 0. 执行结果（2026-08-14）

- 结论：通过。COM-01 生产 Migration/应用已发布，交易 UAT 在隔离本地 Supabase 与 HitPay Sandbox 完成，未在 Production 创建测试财务交易。
- `RUN_ID`：`COM01-UAT-LOCAL-V2-20260814-182536`
- 场景：Appointment 先付后做/先做后付、Walk-in 先做后付、Cash/HitPay、部分+全额退款、幂等重放、跨 Location 拒绝。
- 角色：Owner、Manager、Frontdesk 允许；Instructor 拒绝；Frontdesk 跨 Location 拒绝。
- 浏览器证据：`tmp/com01-uat/COM01-UAT-LOCAL-V2-20260814-182536/screenshots/`，共 10 张非 Loading/Skeleton 截图；`index.json` 记录 URL、页面文本与账务断言。
- DB 证据：`tmp/com01-uat/COM01-UAT-LOCAL-V2-20260814-182536/db-evidence-20260814-183230.txt`；4 个应计项目各 1 条 earned，退款项目以 `-3/-7` 反向 Entry 归零。
- 证据边界：先后顺序由 SQL UAT/DB 断言证明；浏览器截图证明角色权限与交易最终状态，不宣称为逐步点击录屏。

## 环境保护结论（Production 共库）

开发数据库就是 Production 数据库，因此本文件不授权在该共库创建测试交易。本轮已用本机 Docker Supabase 建立隔离 UAT 环境并完成执行。

- 允许：本地 Docker DB Gate、隔离本地 UAT、代码/文档审查，以及显式确认后的 Production 只读查询。
- 禁止：在 Production 创建测试 Sale/Appointment/Payment，或执行 Cash/HitPay 测试付款、fulfill、退款、幂等重放和跨门店写入测试。
- 当前状态：COM-01 已上线；生产发布与隔离 UAT 证据分开保留。

## 0.1 通过标准（必须全部满足）

- 角色矩阵：Owner/Manager/Frontdesk 允许，Instructor 拒绝（含跨门店拒绝）。
- Appointment：先付后做、先做后付均仅产生 1 条 `earned`。
- Walk-in：先付后做、先做后付均仅产生 1 条 `earned`。
- Payment Method：Cash 与 HitPay 均覆盖。
- Refund：部分退款、全额退款后新增 `refund_reversal`，不覆盖原 `earned`。
- 幂等重放：重复触发不会新增重复 `earned/reversal`。
- 每一步都有：截图 + DB 查询证据 + 预期结果。

## 1. 执行前准备

### 1.1 环境与账号

- 目标环境：隔离 UAT Supabase + UAT Web（非 Production）。
- 角色账号：Owner、Global/Location Manager、Frontdesk(L1)、Frontdesk(L2)、Instructor(L1)。
- 门店：至少 L1、L2 两个 Location（用于跨门店拒绝）。
- 员工与服务：L1 至少 1 个可预约/可销售服务和可指派员工。

### 1.2 统一测试标识（必须）

- `RUN_ID`：`COM01-UAT-YYYYMMDD`（示例：`COM01-UAT-20260814`）。
- 所有测试交易 `pos_sales.note` 都必须以 `${RUN_ID}-` 开头。
- 所有测试支付 `payments.reference_code` 都必须以 `${RUN_ID}-` 开头。
- 所有人工 idempotency key（如可控）建议以 `${RUN_ID}-` 开头。

### 1.3 迁移应用（UAT）

> **硬停条件：** `COM01_DB_CLASSIFICATION` 不是精确值 `uat` 时，不得执行本节。本轮仅在本机 Docker Supabase 执行，Production 仍禁止执行 UAT fixture。

在未来的**隔离目标 UAT**按顺序应用（已在仓库中）：

- `supabase/migrations/20260814100000_com01_commission_foundation.sql`
- `supabase/migrations/20260814110000_com01_fixes_p1_p2.sql`
- `supabase/migrations/20260814114000_pos03_hitpay_lock_order_align.sql`

建议命令（任选其一，按团队现有流程）：

```bash
# 必须由执行人显式声明；不要把 Production URL 赋给 COM01_UAT_DB_URL。
test "${COM01_DB_CLASSIFICATION:-}" = "uat" || {
  echo "blocked: COM-01 migrations may run only against isolated UAT" >&2
  exit 1
}

# 方式 A：团队已有 linked project 流程（先人工核对 project ref）
supabase migration list --linked

# 方式 B：直接 psql（显式指向 UAT DB）
psql "$COM01_UAT_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814100000_com01_commission_foundation.sql
psql "$COM01_UAT_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814110000_com01_fixes_p1_p2.sql
psql "$COM01_UAT_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814114000_pos03_hitpay_lock_order_align.sql
```

## 2. 证据文件结构

在本地创建证据目录：

```bash
mkdir -p "tmp/com01-uat/${RUN_ID}/screenshots"
```

截图命名规范（示例）：

- `01-role-owner-pos.png`
- `02-role-instructor-denied.png`
- `10-apt-paid-first-before-complete.png`
- `11-apt-paid-first-after-complete.png`
- `20-apt-complete-first-before-pay.png`
- `21-apt-complete-first-after-pay.png`
- `30-walkin-paid-first-before-fulfill.png`
- `31-walkin-paid-first-after-fulfill.png`
- `40-walkin-fulfill-first-before-pay.png`
- `41-walkin-fulfill-first-after-pay.png`
- `50-refund-partial.png`
- `51-refund-full.png`
- `60-idempotency-replay.png`
- `70-cross-location-denied.png`

DB 证据导出命令：

```bash
COM01_DB_CLASSIFICATION="uat" \
COM01_UAT_DB_URL="$COM01_UAT_DB_URL" \
COM01_UAT_RUN_ID="$RUN_ID" \
bash scripts/collect-com01-uat-evidence.sh
```

该收集器只执行 `READ ONLY` 事务。若未来仅需对 Production 中已有合法业务记录做只读取证，必须额外显式设置
`COM01_ALLOW_PRODUCTION_READONLY=YES`；这不会授权创建或修改任何数据。

## 3. 角色矩阵（浏览器）

> 页面建议：`/dashboard/appointments`、`/dashboard/pos`、`/dashboard/pos/cash-sessions`。

| 步骤 | 操作 | 截图 | 预期 |
|---|---|---|---|
| R1 | Owner 打开 L1 的 POS 与 Appointment 页面 | `01-role-owner-pos.png` | 允许访问与操作入口可见 |
| R2 | Manager 打开 L1 的 POS 与 Appointment 页面 | `01-role-manager-pos.png` | 允许访问与操作入口可见 |
| R3 | Frontdesk(L1) 打开 L1 的 POS 与 Appointment 页面 | `01-role-frontdesk-pos.png` | 允许访问与操作入口可见 |
| R4 | Instructor(L1) 打开 POS 或尝试 fulfill/refund | `02-role-instructor-denied.png` | 被拒绝（无权限或显式拒绝提示） |

## 4. 事务场景（浏览器点击流）

> 每个场景完成后都执行一次 DB 证据导出，并记录“该场景断言”。

### S1 Appointment 先付后做（HitPay）

- 交易 note：`${RUN_ID}-APT-PAID-FIRST-HITPAY`
- Payment ref：`${RUN_ID}-APT-PF-HP`

步骤：
1. 在 POS 创建绑定 Appointment 的 service item，先完成 HitPay 支付。截图：`10-apt-paid-first-before-complete.png`
2. 立即导出 DB 证据。
3. 在 Appointment 页面将该预约标记 `completed`。截图：`11-apt-paid-first-after-complete.png`
4. 再次导出 DB 证据。

预期：
- 第一次导出：该 `pos_sale_item_id` 无 `earned`。
- 第二次导出：该 `pos_sale_item_id` 恰好 1 条 `earned`，`source_type='appointment'`。

### S2 Appointment 先做后付（Cash）

- 交易 note：`${RUN_ID}-APT-COMPLETE-FIRST-CASH`
- Payment ref：`${RUN_ID}-APT-CF-CASH`

步骤：
1. 创建绑定 Appointment 的 service item，不支付；先将 Appointment 标记 `completed`。截图：`20-apt-complete-first-before-pay.png`
2. 导出 DB 证据。
3. 回到 POS 使用 Cash 完成支付。截图：`21-apt-complete-first-after-pay.png`
4. 再次导出 DB 证据。

预期：
- 支付前无 `earned`。
- 支付后恰好 1 条 `earned`，且不重复。

### S3 Walk-in 先付后做（Cash）

- 交易 note：`${RUN_ID}-WALKIN-PAID-FIRST-CASH`
- Payment ref：`${RUN_ID}-WALKIN-PF-CASH`

步骤：
1. 创建 walk-in service item，先 Cash 支付。截图：`30-walkin-paid-first-before-fulfill.png`
2. 导出 DB 证据。
3. 执行 walk-in fulfill。截图：`31-walkin-paid-first-after-fulfill.png`
4. 再次导出 DB 证据。

预期：
- fulfill 前无 `earned`。
- fulfill 后恰好 1 条 `earned`，`source_type='walkin'`，`fulfilled_at` 非空。

### S4 Walk-in 先做后付（HitPay）

- 交易 note：`${RUN_ID}-WALKIN-FULFILL-FIRST-HITPAY`
- Payment ref：`${RUN_ID}-WALKIN-CF-HP`

步骤：
1. 创建 walk-in service item，不支付先 fulfill。截图：`40-walkin-fulfill-first-before-pay.png`
2. 导出 DB 证据。
3. 再完成 HitPay 支付。截图：`41-walkin-fulfill-first-after-pay.png`
4. 再次导出 DB 证据。

预期：
- fulfill 后支付前无 `earned`（先做后付契约）。
- 支付后恰好 1 条 `earned`。

### S5 部分退款与全额退款（反向 Entry）

- 复用场景：建议对 S1 或 S3 的已入账 sale 进行退款。

步骤：
1. 对 service item 做部分退款。截图：`50-refund-partial.png`
2. 导出 DB 证据。
3. 对同 item 再做剩余全额退款。截图：`51-refund-full.png`
4. 导出 DB 证据。

预期：
- 每次退款新增 `refund_reversal`（append-only），不覆盖原 `earned`。
- 同一退款检查点不会重复生成 reversal。

### S6 幂等重放与跨门店拒绝

步骤：
1. 对同一 walk-in item 立即重复触发 fulfill（或前端重复提交）。截图：`60-idempotency-replay.png`
2. 使用 Frontdesk(L2) 尝试操作 L1 sale/item。截图：`70-cross-location-denied.png`
3. 导出 DB 证据。

预期：
- 重放后 `earned` 数量不增加（仍 1 条）。
- 跨门店操作拒绝，DB 不新增违规 entry。

## 5. DB 断言模板（每次导出后核对）

在 `scripts/collect-com01-uat-evidence.sh` 输出文件中核对：

1. `[1]` 基础事实：sale/payment/item/appointment 状态与页面操作一致。
2. `[2]` 分录事实：`earned` 与 `refund_reversal` 数量/金额/来源正确。
3. `[3]` 唯一性：每个 `pos_sale_item_id` 的 `earned_count` 必须 `<= 1`。
4. `[4]` 审计：存在 `com01_walkin_fulfilled`、`com01_commission_earned_recorded`、退款反向审计。
5. `[5]` 幂等：`business_idempotency_keys` 状态与重放行为一致（不出现异常重复完成）。

## 6. 最终验收结论模板

- UAT Run ID：`${RUN_ID}`
- 执行环境：`<UAT 域名 + Supabase project ref>`
- 迁移状态：`已应用/已对齐`
- 浏览器矩阵：`通过/失败（附截图）`
- 交易场景 S1~S6：`通过/失败（附截图 + DB 证据文件）`
- 结论：
  - 全部通过：可将 COM-01 状态升为“已验证/待上线”。
  - 任一失败：保持“已实现/待验证”，记录阻塞项并修复后复验。

## 7. 注意事项

- 不允许在 Production 写入财务测试数据。
- 不允许为了完成本验收而把真实客户、真实员工或真实支付改名为测试 fixture。
- 不允许在 Production 执行第 1.3 节 migration 命令或第 4 节事务点击流。
- HitPay 仅使用隔离 UAT 的 Sandbox merchant key/webhook salt。
- 证据文件使用最小化字段且本地权限为仅当前用户；禁止包含客户联系方式、自由文本备注、access token、refresh token 或 magic link 全链路 URL。

# MKT-01：分组和 Email 内容

状态：完成

负责人：Codex

开始日期：2026-08-17

## 1. 目标

为 Owner/Manager 提供按 VIP、高频及沉睡客户创建的、受 Email Consent 和 Suppression 保护的营销活动草稿及收件人快照。

## 3. 依赖与输入契约

- 已完成依赖：FND-02、CRM-01、POS-04。
- 复用的数据身份：Studio / Location / Salon Customer。

## 4. 本任务必须完成

- 数据库：活动、抑制名单、不可变收件人快照、RLS 与 RPC。
- 服务端：Owner/Manager 及 Location Scope 二次验证。
- 页面或接口：Audience、固定 Email Builder、一键退订、测试邮件。
- 审计：活动快照建立操作。

## 5. 明确不做

- 不做真实批量发送、定时调度、provider webhook、点击追踪、报表或 AI 文案（MKT-02）。
- 不将健康档案、过敏信息或治疗备注用于任何受众或模板。

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 查看/建立活动 | 是 | 是 | 仅本 Location | 否 | 否 | 否 | 否 |
| 退订自己的 Token | - | - | - | - | - | - | 是 |

## 7. Migration 和回填

- Migration：`20260817140000_mkt01_marketing_audience_campaign_foundation.sql`、`20260817140100_mkt01_marketing_cross_scope_constraints.sql`（Supabase CLI 创建）。
- 不回填；仅在创建活动时形成快照，可安全重跑 migration。

## 8. 验收场景

- [x] Consent/Suppression 不进入 eligible 收件人（`mkt01_create_campaign_snapshot`）。
- [x] Studio 和 Location Scope 在 RPC 中拒绝越权（`mkt01_assert_actor_scope` 与 scope trigger）。
- [x] Token 退订不暴露客户资料（通用确认页）。
- [x] `npx tsc --noEmit`。

## 9. 实际交付

### 修改文件

- 两个 MKT-01 Supabase migrations、营销 Server Action/服务层、`/dashboard/marketing`、退订 route 和导航入口。

### 数据库变化

- 本地已执行 `npx supabase migration up --local`，两个 migration 均已应用。

### 验证结果

- 通过：针对修改文件的 ESLint、`npx tsc --noEmit`、`git diff --check`。
- `npx supabase db lint --local` 仍报告既有预约/套餐函数错误；本次 migration 没有产生新 lint 项。

### 未解决风险

- 现有 `uat.flows.json` 没有覆盖 Marketing 页面，故没有执行不匹配的浏览器 flow；MKT-02 应新增本地营销 UAT 后覆盖派送前检查。

## 10. 后续任务接口

MKT-02 可只处理 `marketing_campaign_recipients.eligibility = 'eligible'` 的快照，不得重新从客户档案读取 Consent 后绕过二次检查。

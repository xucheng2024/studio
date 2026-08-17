# APT-05：Appointment Email Notifications

状态：已实现（MVP）/待生产联调

负责人：Codex

开始日期：2026-08-12

完成日期：

Commit / Release：未提交

## 1. 目标

在不修改 APT-03 状态机的前提下，为预约 create/confirm/reschedule/cancel 建立可重试、可失效、可观测的邮件通知队列与发送流程。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/01-appointment.md`
- `docs/salon-psg/10-development-backlog.md`（APT-05）
- `docs/salon-psg/16-complete-implementation-plan.md`（APT-05）
- `docs/salon-psg/tasks/APT-03.md`
- `docs/salon-psg/tasks/FND-04.md`
- `src/lib/salon-appointments.ts`
- `src/lib/idempotency.ts`
- `src/lib/email.ts`
- `node_modules/next/dist/docs/` 中 Route Handlers / Server Actions / Caching 相关文档

## 3. 依赖与输入契约

- 已完成依赖：`APT-03`、`FND-04`
- 复用的数据身份：Studio / Location / Customer / Employee / Appointment
- 幂等契约：复用 `FND-04` Claim/Complete/Fail fencing，不新增平行幂等模型
- 仍需产品或外部确认：
  - 邮件模板文案与多语言策略
  - 提醒发送窗口（例如提前 24h/2h）
  - 失败告警 SLA 与人工补发流程

## 4. 本任务必须完成

- 明确触发点：`create`/`confirm`/`reschedule`/`cancel` 各状态对应通知事件（不改 APT-03 状态机）
- 设计通知队列表：事件类型、目标预约、幂等键、计划发送时间、状态、失败重试计数
- 实现入队逻辑：在现有状态变更成功后写入队列，复用 FND-04 幂等契约防重
- 实现发送 Worker/Cron：批量拉取待发送、调用邮件服务、写发送结果与错误摘要
- 实现重试与失效：指数退避；改期/取消后旧提醒任务标记失效，禁止继续发送
- 增加运营可见性：最小发送日志/查询接口（仅后台可见）

## 5. 明确不做

- 不改 APT-03 状态机定义与既有状态迁移规则
- 不引入短信、Push、WhatsApp 渠道
- 不重构 CRM/Marketing 自动化中心
- 不修改任何既有已应用 Migration

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 查看通知发送日志 | ✅ | ✅ | ✅（限授权门店） | ✅（限授权门店） | ❌ | ❌ | ❌ |
| 手动重试失败通知 | ✅ | ✅ | ✅（限授权门店） | ❌ | ❌ | ❌ | ❌ |
| 执行发送 Worker/Cron | service_role | service_role | service_role | service_role | service_role | ❌ | ❌ |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

## 7. Migration 和回填

- Migration 文件：待 Supabase CLI 生成（APT-05）
- 现有数据策略：上线后只对新增队列生效，不追溯历史已完成预约
- 冲突/异常报告：保留最近一次错误摘要与累计重试次数
- 可重跑策略：队列与 Worker 均需幂等，Cron 重复触发不重复发送
- 回滚或上线风险：邮件重复发送、旧提醒未失效、模板变量缺失

## 8. 验收场景

- [x] `npm run test:apt03`（回归：确保未破坏预约流程）
- [x] `npm run test:apt05-app`（事件映射、幂等、防旧提醒）
- [x] `npm run test:apt05-db`（队列状态机、重试、失效）
- [x] `npm run test:apt05-cron`（重复 Cron 不重复发送）
- [x] `npx tsc --noEmit`

## 9. 实际交付

### 修改文件

- `docs/salon-psg/tasks/APT-05.md`
- `supabase/migrations/20260812230000_apt05_appointment_email_notifications.sql`
- `supabase/migrations/20260812235000_apt05_manual_retry_rpc.sql`
- `scripts/sql/verify_apt05_notification_queue.sql`
- `scripts/verify-apt05-app.mjs`
- `scripts/verify-apt05-db.sh`
- `scripts/verify-apt05-cron.sh`
- `scripts/tests/apt05-app-contract.test.ts`
- `scripts/tests/apt05-db-queue-state.test.ts`
- `scripts/tests/apt05-cron-dedup.test.ts`
- `src/lib/appointment-notification-rules.ts`
- `src/lib/appointment-notifications.ts`
- `src/lib/salon-appointments.ts`
- `src/lib/email.ts`
- `src/app/api/cron/apt05-email/route.ts`
- `src/app/api/operations/appointments/notifications/route.ts`
- `package.json`

### 数据库变化

- 新增通知队列表：`public.appointment_notification_queue`
- 新增 RPC：
  - `enqueue_appointment_notification_email`
  - `claim_appointment_notification_email_jobs`
  - `complete_appointment_notification_email_job`
  - `fail_appointment_notification_email_job`
  - `list_appointment_notification_email_jobs`
  - `retry_appointment_notification_email_job`

### 验证结果

- [x] `npm run test:apt03`
- [x] `npm run test:apt05`
- [x] `npx tsc --noEmit`

### 未解决风险

- 邮件模板已切为英文事件化文案，但仍为 MVP 版本，尚未接产品最终文案。
- 当前 Cron 以 `CRON_SECRET` 保护，尚未补充生产告警与观测看板。
- 发送已改为该 Studio 自己的 Resend 密钥；未配置时不得回退平台 key。隔离 Email settings UAT 已通过；生产仍需 Owner 启用该店 Resend。

没有实际命令输出或测试证据时，不勾选对应项目。

## 10. 后续任务接口

- 稳定入口：
  - `npm run test:apt05-app`
  - `npm run test:apt05-db`
  - `npm run test:apt05-cron`
  - `npm run test:apt05`
- 禁止假设：
  - 不假设通知会在主事务内同步发送
  - 不假设 Cron 单实例执行
  - 不假设第三方邮件提供商零失败

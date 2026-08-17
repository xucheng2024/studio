# MKT-02：调度、Webhook 和报告

状态：已实现/待目标环境验证

负责人：Codex

开始日期：2026-08-17

## 目标

在 MKT-01 不可变收件人快照上完成 Email Campaign 的立即/预约发送、Resend Webhook、重试、Suppression、CTA 点击和报告闭环。

## 实际交付

- `mkt02_schedule_campaign` 在排队时及首次派送前再次检查最新 Consent、Suppression 和 Email 格式。
- `mkt02_claim_dispatch_batch` 使用数据库锁、Claim Token、稳定 Batch ID 和 Resend Idempotency Key 防止重复 Cron 发送；已知失败按指数退避重试，最多五次。
- `/api/cron/dispatch-campaigns` 每五分钟处理最多 50 位收件人；每位收件人使用独立 To、退订和点击 Token。
- `/api/webhooks/resend` 使用原始请求体验证 Svix 签名，并复用 FND-04 `provider_events` 去重；Delivered、Failed、Bounced、Complained、Suppressed 和 Clicked 写入历史事件。
- Hard Bounce、Complaint 和 Provider Suppression 自动加入 Studio Email Suppression。
- `/r/c/[token]` 记录唯一 CTA 点击后只重定向到 `NEXT_PUBLIC_APP_URL` 或 `MARKETING_CTA_ALLOWED_HOSTS` 明确允许的 HTTPS 域名，Token 不包含客户资料。
- Campaign 报告展示快照、排除、Attempted、Submitted、Delivered、Failed、Bounced、Complained、Unique Clicked、Unsubscribed、成功率和点击率；失败收件人可由 Owner/Manager 手动重试。

## 验证结果

- 通过：MKT-02 DB 状态机专项验证（重复 Claim、重试、完成、Delivered、点击和 Bounce Suppression）。
- 通过：MKT-02 静态安全/幂等契约测试、`npx tsc --noEmit`、定向 ESLint、`git diff --check`。
- 通过：隔离本地 `mkt01-marketing-local` 浏览器回归（Consent/Suppression、匿名退订、角色拒绝、390×844 移动布局）。
- 一键复验：`npm run test:mkt02`（仅允许本地 Supabase，依次执行非破坏性 Migration 预检、DB 状态机、应用契约和浏览器 UAT）。

## 目标环境待办

- 配置 `RESEND_API_KEY`、`RESEND_FROM_EMAIL`、`RESEND_WEBHOOK_SECRET`、`NEXT_PUBLIC_APP_URL`、`MARKETING_CTA_ALLOWED_HOSTS` 和 `CRON_SECRET`。
- 在 Resend 建立 `/api/webhooks/resend`，订阅 Sent、Delivered、Failed、Bounced、Complained、Suppressed 和 Clicked。
- 使用受控测试地址留存真实立即发送、预约发送、重复 Webhook、Bounce/Complaint 和点击报告证据。

## 发布清单

1. 在目标 Supabase 先应用 `20260817150000_mkt02_campaign_dispatch_reporting.sql`，确认新表启用 RLS、敏感 RPC 仅授予 `service_role`，再发布应用。
2. 在 Vercel Production 配齐上述六个变量；`NEXT_PUBLIC_APP_URL` 必须是正式 HTTPS Origin，`MARKETING_CTA_ALLOWED_HOSTS` 仅填写已验证且业务实际使用的精确主机名。
3. 发布后确认 `/api/cron/dispatch-campaigns` 已注册为每五分钟执行，并用无效 Bearer Token 验证返回 `401`，不得手工触发真实收件人批次。
4. 在 Resend 建立正式 Webhook，复制其 Signing Secret 到 `RESEND_WEBHOOK_SECRET` 后重新部署；确认签名失败返回 `401`、同一 `svix-id` 重放不会重复写业务事件。
5. 仅用受控地址建立一条立即发送和一条未来预约 Campaign，核对 Submitted、Delivered、Unique clicked、退订和报告数字；再用专用退信地址验证 Suppression。
6. Go/No-Go：Cron 无连续 5xx、无跨 Studio/Location 数据、无重复邮件、退订后不再派送、报告与 Resend Event 一致，才开放真实 Campaign。

回退时先暂停 Vercel Cron 和 Resend Webhook，再回退应用版本；数据库变更为加法式，事故窗口内保留 Schema 与审计证据，不执行破坏性 Down Migration。`dispatch outcome could not be reconciled` 的收件人禁止直接重试，应先按 Resend Provider ID/日志人工对账。

# FND-04：强审计与幂等基础

状态：未开始

## 1. 目标

为后续 Appointment、Package、POS、HitPay、Commission、敏感资料和 Payroll 提供一套可复用的强审计、业务请求幂等和 Provider Event 去重基础。它只建立基础设施，不实现任何后续业务模块。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/10-development-backlog.md` 的 FND-04
- `docs/salon-psg/16-complete-implementation-plan.md` 的 FND-04
- `docs/salon-psg/tasks/FND-01.md` 至 `FND-03.md`
- 现有 `operation_audits`、`guest_merge_audits`、Salon Customer Merge Audit、FND-03 Audit 写入
- `src/lib/audit.ts`、`src/lib/scope.ts`、`src/lib/employees.ts`、`src/lib/salon-customers.ts`
- 现有付款、HitPay Webhook、Booking Cancel 和 Capacity RPC 的幂等模式
- 实际改动涉及的 Next.js 16 本地文档

## 3. 本任务必须完成

### 强审计

- 保留现有 `operation_audits` 和普通 best-effort `writeOperationAudit` 行为，不能破坏现有接口。
- 为关键业务提供同事务写入的强审计入口，至少明确 `studio_id`、可选 `location_id`、actor/system 身份、action、target、before/after、correlation/idempotency reference 和时间。
- 新增记录必须验证 Location 属于同一 Studio。
- 强审计记录 Append-only；普通应用路径不能 UPDATE 或 DELETE。
- 历史 `operation_audits` 不删除、不猜测租户或门店。能从明确外键/合法快照安全确认的才可回填，否则保持 Legacy 状态或进入明确报告。

### 业务请求幂等

- 建立 Studio-scoped Idempotency Key 存储和原子 Claim/Complete/Fail 流程。
- 唯一性至少包含 Studio、Operation Scope 和 Idempotency Key。
- 保存 Request Hash，重复 Key + 相同请求返回已有状态/结果；重复 Key + 不同 Request Hash 必须拒绝。
- 并发 Claim 同一 Key 时最多一个调用取得执行权。
- 明确处理中、完成、失败和可重试语义；不能让永久失败无限重试。
- Response Snapshot 不得保存 Secret、完整敏感健康资料或 Payroll 明细。

### Provider Event 去重

- 建立 Provider/Event ID 唯一约束、Payload Hash、状态、尝试次数、收到/处理时间和安全错误摘要。
- 重复事件不能生成第二个业务动作；相同 Event ID 但不同 Payload Hash 必须记录冲突并拒绝静默覆盖。
- 不保存 Provider Secret；原始 Payload 如含个人资料应只保存必要、受控字段或 Hash。

### 服务端库

- 新增最小 server-only TypeScript 库，沿用 `src/lib/employees.ts`、`salon-customers.ts` 和 `scope.ts` 模式。
- 所有 actor-scoped 入口在使用 Admin Client 前再次验证 Studio/Location Membership；具体业务动作允许哪些角色，由后续业务模块决定，FND-04 不发明统一角色规则。
- 提供后续模块可复用的强审计、Claim/Complete/Fail 和 Provider Event 接口，不连接具体 Appointment/POS/Payroll 业务。

## 4. 明确不做

- 不实现 Appointment、Package Ledger、POS、Payment、Commission、Marketing 或 Payroll。
- 不改 FND-01、FND-02、FND-03 的数据模型和业务行为。
- 不把所有旧 best-effort 操作日志一次性迁成强审计。
- 不建立具体 HitPay/Resend Webhook Handler。
- 不新增 UI 或无关依赖。
- 不修改无关功能，不 Commit、不 Push、不执行生产 SQL。

## 5. 数据库和安全要求

- 使用 Supabase CLI 生成新的 Migration 文件名。
- 所有新 Public 表启用 RLS；默认拒绝 anon/authenticated/PUBLIC，按现有服务器架构只授予必要的 `service_role` 权限。
- SECURITY DEFINER 函数固定 `search_path`，函数内部验证输入一致性，并撤销 PUBLIC/anon/authenticated 执行权限。
- 对唯一键、查询状态、Studio、Provider/Event 建立必要索引。
- Migration 保留现有数据，可在空库、现有数据及二次执行场景安全执行。
- 不暴露 Service Role 或 Secret 到客户端。

## 6. 最低验证

- [ ] `npx tsc --noEmit`
- [ ] 相关 ESLint
- [ ] Migration 在真实本地 Postgres/Supabase 首次和二次执行
- [ ] 现有普通 `operation_audits` 写入仍可工作
- [ ] 强审计与业务写入同事务成功/回滚
- [ ] 强审计 UPDATE/DELETE 被拒绝
- [ ] Location/Studio 不一致及跨 Studio 被数据库拒绝
- [ ] 相同幂等 Key + 相同 Hash 返回已有结果
- [ ] 相同幂等 Key + 不同 Hash 被拒绝
- [ ] 两个并发 Claim 最多一个获得执行权
- [ ] Provider Event 重放只处理一次
- [ ] 相同 Provider Event ID + 不同 Payload Hash 产生冲突
- [ ] 不属于目标 Studio/Location 的 Actor 被服务端拒绝；客户端角色不能直接执行内部表/RPC
- [ ] anon/authenticated/service_role 的表与 RPC 权限矩阵符合设计
- [ ] FND-01、FND-02、FND-03 最小回归通过

## 7. 完成交付报告

- 修改文件列表
- 数据模型和现有 Audit 兼容策略
- RLS/RPC/权限设计
- 每个验证场景的实际结果
- Migration 风险和遗留 Legacy Audit 数量
- 后续 APT-02、PKG-01、POS-01、MKT-02、PAY-02 应如何复用
- 明确列出未做范围，然后停止

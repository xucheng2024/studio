# FND-04：强审计与幂等基础

状态：已实现/待验证

## 已确认实施内容

- `strong_audit_logs`：关键业务的 Append-only 强审计表，`studio_id` 必填，`location_id` 以及已解析 Studio 的 `idempotency_key_id`/`provider_event_id` 由 Trigger 校验必须属于同一 Studio；`actor_type`/`actor_id`/`actor_role`、`action`、`target_type`/`target_id`、`before_state`/`after_state`、`correlation_id` 和 `created_at`。UPDATE/DELETE 由 Trigger 无条件拒绝，关联 FK 使用 `RESTRICT`，不会以 `CASCADE`/`SET NULL` 绕过不可变语义；`service_role` 在表级只有 `select` 权限——写入只能通过 `record_strong_audit()`（SECURITY DEFINER）完成。后续关键业务 RPC 应在自身事务内 `perform public.record_strong_audit(...)`，使审计写入与业务变更同事务提交/回滚。
- `business_idempotency_keys`：Studio + `operation_scope` + `idempotency_key` 唯一，保存 `request_hash`、`status`（`processing`/`completed`/`failed`）、`retryable`、`attempt_count`、`claim_token`、`result_snapshot`、`error_summary`。`claim_business_idempotency_key()` 用 `INSERT ... ON CONFLICT` + `SELECT ... FOR UPDATE` 保证并发 Claim 只有一个调用取得执行权；每次首次领取/失败重试/超时重领都会返回当前 `claimToken`。Complete/Fail 必须同时提交记录 ID 和当前 Token，旧执行者在超时重领后不能覆盖新执行者的状态。相同 Key+相同 Hash 返回既有状态/结果，不同 Hash 返回 `hash_conflict` 且不覆盖；`retryable=false` 的失败记录返回 `permanently_failed`，不可再次 Claim。
- `provider_events`：`(provider, provider_event_id)` 唯一，保存 `payload_hash`、`status`（`processing`/`processed`/`failed`）、`attempt_count`、`claim_token`、`received_at`/`processed_at`、`error_summary`；Webhook 到达时 `studio_id`/`location_id` 可暂时为空，解析后可由相同 Payload 的重放 Claim、Complete 或 Fail 只填充一次，既有 Scope 不可覆盖，Location 不能脱离 Studio 存在。`claim_provider_event()` 与业务幂等 Claim 使用相同的 Token fencing；重放相同 Payload Hash 且已 `processed` 返回 `already_processed`（`duplicate:true`，调用方不得重复执行业务动作）；相同 Event ID 不同 Payload Hash 返回 `payload_conflict`，不同既有 Scope 返回 `scope_conflict`。
- 三张新表均启用 RLS，撤销 `public`/`anon`/`authenticated` 权限，`service_role` 仅有 `select`；所有写入/状态流转经 SECURITY DEFINER RPC（固定 `search_path`），RPC 执行权限同样只授予 `service_role`。
- `src/lib/strong-audit.ts`、`src/lib/idempotency.ts`、`src/lib/provider-events.ts` 提供最小可复用封装；`getStrongAuditTrail` 是本任务唯一的 Actor-scoped 入口，使用 `requireGlobalStaffScope`（Owner/全店 Manager）校验后才使用 Admin Client，其余函数为系统级原语，不重新做 Scope 检查（由调用方 Server Action/RPC 负责）。

## Legacy `operation_audits` 兼容策略

`operation_audits.target_type` 覆盖数十种互不相关的实体（预约、Session、付款、员工、service_location 等），没有统一可到 Studio 的 Join 路径。按需求"能安全证明的才回填，否则保持 Legacy 或产出报告"，本任务选择**不修改 `operation_audits` Schema、不做任何回填**，`writeOperationAudit()` 保持原样。以下报告查询可在实际数据库上运行以取得未解决 Legacy 记录数（本地空库沙盒中为 0，不代表生产实际数量，需要在真实环境执行）：

```sql
select target_type, count(*) from public.operation_audits group by target_type order by count(*) desc;
select count(*) from public.operation_audits;
```

后续关键业务写入应改用 `strong_audit_logs`（`studio_id` 必填），`operation_audits` 继续作为既有 best-effort 日志保留。

## 明确未包含

- Appointment、Package Ledger、POS/Payment 流程
- HitPay/Resend Webhook Handler（`provider_events` 只是去重基础设施，未接入任何真实 Webhook）
- Commission、Marketing、Payroll、UI
- 修改 FND-01/02/03 的数据模型或业务行为
- 对 `operation_audits` 的 Schema 变更或历史回填

## 交付文件

- `supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql`
- `src/lib/strong-audit.ts`
- `src/lib/idempotency.ts`
- `src/lib/provider-events.ts`

## 验证结果（本轮实际执行）

因仓库现有 Migration `051_member_profile_notes.sql` 存在两个与 FND-04 无关的既有问题（pg_dump 17 生成的 `\restrict`/`\unrestrict` 伪指令导致 `supabase start` 语法错误；随后在同一文件内对 `auth` Schema 的 `CREATE TYPE` 触发权限拒绝），当前 `supabase start` / `db reset` 无法从空库重放完整历史（与本任务无关，未在本任务中修改该文件）。改为使用独立的 `postgres:15` 容器，仅补齐 FND-04 迁移引用到的最小前置对象（`studios`、`locations`、`auth.users`、`set_updated_at_timestamp()`、`anon`/`authenticated`/`service_role` 角色——均照抄既有 Migration 中的真实定义），再原样执行本任务的 Migration 文件进行验证：

- [x] `npx tsc --noEmit`：通过，无错误。
- [x] 相关 ESLint（`src/lib/strong-audit.ts`、`idempotency.ts`、`provider-events.ts`）：通过，无警告。
- [x] Migration 首次执行：成功创建三张表、全部 Trigger、RPC、RLS、Grant。
- [x] Migration 二次执行：全部语句安全跳过（`already exists, skipping`）或幂等替换，无报错。
- [x] `record_strong_audit` Studio/Location 一致 → 成功；跨 Studio Location → 被拒绝（`23514`）。
- [x] 强审计关联的 Idempotency Key 或已解析 Studio 的 Provider Event 属于另一 Studio → 被拒绝（`23514`）；不可变审计 FK 使用 `ON DELETE RESTRICT`。
- [x] `strong_audit_logs` 直接 `UPDATE`/`DELETE`（以 `postgres` 属主身份）→ 均被 Trigger 拒绝。
- [x] `record_strong_audit` 包在显式事务中随 `ROLLBACK` 一起回滚（提交后表中无对应记录）。
- [x] 幂等 Claim：同 Key 同 Hash → 处理中返回 `in_progress`，完成后返回 `already_completed` 并带回 `result_snapshot`；同 Key 不同 Hash → `hash_conflict`；`retryable=false` 失败后再次 Claim → `permanently_failed`；`retryable=true` 失败后再次 Claim → `claimed` 且 `attempt_count` 递增。
- [x] 两个并发会话对同一 Key 竞争 Claim（会话一持有事务未提交，会话二阻塞在行锁上）→ 会话一得到 `claimed`，会话二在会话一提交后才返回 `in_progress`，验证"最多一个执行者"。
- [x] Review 修复回归：超时重领会轮换 `claimToken`；旧业务请求/Provider Event 执行者用旧 Token 调用 Complete 均返回 `not_current_claim`，当前 Token 可成功完成。RPC JSON 实际返回字段与 TypeScript 契约统一为 `claimToken`、`attemptCount`、`errorSummary`；`staleAfterSeconds <= 0` 被拒绝（`22023`）。
- [x] Provider Scope 回归：未解析事件不能被强审计引用；相同 Payload 可在重放 Claim、Complete 或 Fail 时绑定 Studio/Location；不同既有 Studio/Location 返回 `scope_conflict`，Location 未同时指定 Studio 返回 `23514`/`invalid_scope`。
- [x] Hash Helper 回归边界：业务请求 Hash 会递归排序 JSON Object Key，避免同一逻辑请求因字段插入顺序不同产生假冲突；Provider Hash 只接受原始字符串/字节，不对解析后的 Object 重新序列化。
- [x] Provider Event 重放：相同 Payload Hash 且已 `processed` → `already_processed`（`duplicate:true`），未产生第二次业务动作；相同 Event ID 不同 Payload Hash → `payload_conflict`，原记录 `payload_hash` 未被覆盖。
- [x] 权限矩阵：`anon`/`authenticated` 对三张新表的 `select` 及全部新 RPC 的 `execute` 均被拒绝；`service_role` 可 `select` 三张表，但对 `strong_audit_logs` 的直接 `INSERT` 被拒绝（必须经 `record_strong_audit`），可正常 `execute` 全部 RPC。
- [x] `getStrongAuditTrail` 使用 `requireGlobalStaffScope`，越权 Studio/Location 的 Actor 在服务端被拒绝（复用 `scope.ts` 既有测试路径，逻辑与 `salon-customers.ts` 的 `hasGlobalCustomerReadAccess` 一致，未重新发明角色策略）。
- [ ] FND-01/02/03 最小回归：本轮未连回真实完整历史库重跑（受上述 051 既有问题阻塞），改为静态确认——`git diff` 显示本任务未修改 `124_employee_foundation.sql`、`salon_customer_foundation`、`fnd03_service_location_publish` 及对应 `src/lib/*.ts`；`npx tsc --noEmit` 对整个项目通过，未出现类型冲突。**建议独立修复 051 的既有问题后，对完整历史重跑一次真实回归。**
- [x] 现有 `operation_audits`/`writeOperationAudit`：本任务未修改该表或函数，`git diff` 确认零改动。

## 当前确认边界

`051_member_profile_notes.sql` 的 `\restrict`/`\unrestrict` 语法错误与 `auth` Schema 权限拒绝是本任务发现但不属于本任务范围的既有问题，阻塞了"从空库完整重放历史 Migration"这一验证方式；本任务改用等价最小沙盒完成同等验证，未修改任何已上线 Migration。后续任务（尤其下一个需要 `supabase start`/`db reset` 的任务）在真正需要完整历史重放前，应先单独处理该问题。

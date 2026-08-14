# PKG-02 审批流 RPC Contract（v1）

> 对应迁移：`supabase/migrations/20260814008000_pkg02_maker_checker_approval_foundation.sql`

## 1. 目标

该合同定义 PKG-02 Maker-Checker 审批主流程的服务边界，供 Dashboard Server Actions 与后续 UI 对接：

- 状态机：`draft -> submitted -> approved/rejected -> applied`
- 角色约束：`maker`（owner/manager/frontdesk）、`checker`（owner/manager）
- 关键规则：同人不可自批、`applied` 必须写 `manual_adjustment` ledger、`apply` 支持幂等重放

## 2. RPC 列表

## 2.1 `pkg02_create_adjustment_request`

- 语义：创建草稿申请（`draft`）
- 角色：`maker`
- 幂等：无（由调用侧决定是否做去重）

入参（核心）：

- `p_actor_id uuid`
- `p_actor_role text`
- `p_studio_id uuid`
- `p_client_package_id uuid`
- `p_requested_delta_credits integer`（非 0）
- `p_reason text`
- `p_requested_value_delta_amount numeric`（符号需与 credits 一致）
- `p_currency text default 'SGD'`
- `p_location_id uuid`
- `p_salon_customer_id uuid`
- `p_metadata jsonb`

成功返回（JSON）：

```json
{
  "ok": true,
  "request_id": "uuid",
  "status": "draft",
  "version": 1
}
```

## 2.2 `pkg02_submit_adjustment_request`

- 语义：maker 提交草稿进入 `submitted`
- 角色：`maker`
- 并发：支持 `p_expected_version` 乐观并发校验

入参（核心）：

- `p_actor_id uuid`
- `p_actor_role text`
- `p_studio_id uuid`
- `p_request_id uuid`
- `p_expected_version integer default null`
- `p_note text default null`

成功返回：

```json
{
  "ok": true,
  "request_id": "uuid",
  "status": "submitted",
  "version": 2
}
```

## 2.3 `pkg02_decide_adjustment_request`

- 语义：checker 审批/拒绝
- 角色：`checker`（owner/manager）
- 约束：maker 不可审批自己的申请

入参（核心）：

- `p_actor_id uuid`
- `p_actor_role text`
- `p_studio_id uuid`
- `p_request_id uuid`
- `p_decision text`（`approved` / `rejected`）
- `p_expected_version integer default null`
- `p_rejection_reason text default null`
- `p_note text default null`

成功返回：

```json
{
  "ok": true,
  "request_id": "uuid",
  "status": "approved",
  "version": 3
}
```

或（拒绝）：

```json
{
  "ok": true,
  "request_id": "uuid",
  "status": "rejected",
  "version": 3
}
```

## 2.4 `pkg02_apply_adjustment_request`

- 语义：将已批准申请落账为 `manual_adjustment`，并切换至 `applied`
- 角色：`checker`（owner/manager）
- 幂等：强制（`idempotency_key + request_hash`）

入参（核心）：

- `p_actor_id uuid`
- `p_actor_role text`
- `p_studio_id uuid`
- `p_request_id uuid`
- `p_idempotency_key text`
- `p_request_hash text`
- `p_expected_version integer default null`
- `p_note text default null`
- `p_correlation_id text default null`

首次成功返回：

```json
{
  "ok": true,
  "already_applied": false,
  "request_id": "uuid",
  "status": "applied",
  "ledger_entry_id": "uuid",
  "version": 4
}
```

重放返回（同 key/hash）：

```json
{
  "ok": true,
  "already_applied": true,
  "request_id": "uuid",
  "status": "applied",
  "ledger_entry_id": "uuid",
  "version": 4
}
```

## 3. 错误语义（建议前端映射）

- `42501`：权限/角色问题（含同人不可自批）
- `P0002`：数据不存在（request/package/studio）
- `22023`：参数非法（空值、非法 decision 等）
- `23514`：业务约束失败（状态不允许、余额不足、sign 不匹配）
- `40001`：并发版本冲突（`expected_version` 不匹配）

## 4. 状态迁移与审计要求

- 所有状态变更必须写 `pkg02_approval_logs`
- `apply` 必须：
  - 写 `client_package_ledger_entries(event_type='manual_adjustment')`
  - 写 `strong_audit_logs`
  - 更新 `client_packages.credits_left`
- `pkg02_approval_logs` append-only，不允许 update/delete

## 5. Dashboard Action 对接建议

Server Action 建议保持与 RPC 一一映射：

- `createPkg02AdjustmentRequestAction`
- `submitPkg02AdjustmentRequestAction`
- `approvePkg02AdjustmentRequestAction`
- `rejectPkg02AdjustmentRequestAction`
- `applyPkg02AdjustmentRequestAction`

统一返回结构建议：

```ts
type DashboardFormResult = {
  ok: boolean;
  message: string;
}
```

如需向 UI 暴露 request/ledger id，可扩展返回字段，但默认 message-first。

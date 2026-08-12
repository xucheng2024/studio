# POS-01 `request_hash` 规范（API 层）

状态：生效（2026-08-13）

## 1. 目的

POS-01 的写入 RPC（`create_pos_sale_draft`、`upsert_pos_sale_item`、`lock_pos_sale`）必须复用 FND-04 的 Claim/Complete/Fail 幂等栅栏。`idempotency_key` 只负责“哪一次业务操作”，`request_hash` 负责“这次操作的请求内容是否一致”。

统一 `request_hash` 规则可以避免：

- 同一 `idempotency_key` 被不同 payload 复用（应返回 `hash_conflict`）
- 前后端字段顺序、空值表示不一致导致误判
- 不同入口（Server Action / Route Handler / Cron）对同一业务请求算出不同哈希

## 2. 强制规则

1. 哈希算法固定：`sha256`
2. 输入必须是 JSON 兼容 payload（不可含循环引用、`bigint`）
3. 对象键名递归排序后再序列化
4. `undefined` / `function` / `symbol`：对象字段中忽略；数组元素中转为 `null`
5. 不把瞬时字段放入 payload：如 `now()`、trace id、UI 本地状态
6. 不把敏感明文放入 payload：哈希输入允许包含业务字段，但不应复制完整敏感正文
7. 统一通过 `src/lib/idempotency.ts` 的 `hashIdempotencyRequest()` 生成

> 结论：不要手写 `JSON.stringify(...)+crypto.createHash(...)`，直接走统一 helper。

## 3. 通用实现模板

```ts
import { hashIdempotencyRequest } from "@/lib/idempotency";

const requestPayload = {
  // 仅包含会影响业务结果的字段
};

const requestHash = hashIdempotencyRequest(requestPayload);
```

## 4. POS-01 各 RPC payload 规范

### 4.1 `create_pos_sale_draft`

最小建议字段（按语义，不要求代码顺序）：

- `operation`: 固定值 `"pos_sale:create_draft"`
- `studioId`
- `locationId`
- `salonCustomerId`（可为 `null`）
- `note`（建议 `trim` 后；空字符串归一为 `null`）
- `currency`（当前默认 `SGD`，仍建议显式入 hash 以支持未来扩展）

示例：

```ts
const requestHash = hashIdempotencyRequest({
  operation: "pos_sale:create_draft",
  studioId,
  locationId,
  salonCustomerId: salonCustomerId ?? null,
  note: note?.trim() ? note.trim() : null,
  currency: "SGD",
});
```

### 4.2 `upsert_pos_sale_item`

最小建议字段：

- `operation`: 固定值 `"pos_sale_item:upsert"`
- `studioId`
- `saleId`
- `itemId`（可为 `null`）
- `lineNumber`（可为 `null`）
- `itemType`
- `serviceId` / `productId` / `packageId`
- `salonAppointmentId`（可为 `null`）
- `employeeId`（可为 `null`）
- `itemNameSnapshot`（建议 `trim`）
- `itemCurrencySnapshot`（建议 `toUpperCase()`）
- `quantity`
- `unitPriceAmount`
- `discountAmount`
- `taxAmount`

示例：

```ts
const requestHash = hashIdempotencyRequest({
  operation: "pos_sale_item:upsert",
  studioId,
  saleId,
  itemId: itemId ?? null,
  lineNumber: lineNumber ?? null,
  itemType,
  serviceId: serviceId ?? null,
  productId: productId ?? null,
  packageId: packageId ?? null,
  salonAppointmentId: salonAppointmentId ?? null,
  employeeId: employeeId ?? null,
  itemNameSnapshot: itemNameSnapshot.trim(),
  itemCurrencySnapshot: itemCurrencySnapshot.trim().toUpperCase(),
  quantity,
  unitPriceAmount,
  discountAmount,
  taxAmount,
});
```

### 4.3 `lock_pos_sale`

最小建议字段：

- `operation`: 固定值 `"pos_sale:lock"`
- `studioId`
- `saleId`

示例：

```ts
const requestHash = hashIdempotencyRequest({
  operation: "pos_sale:lock",
  studioId,
  saleId,
});
```

## 5. API 层接入清单

- 每个写入口必须同时提供：
  - `idempotency_key`（客户端传入，或服务端兜底生成）
  - `request_hash`（服务端按本规范生成）
- 传给 DB RPC 前，先做字段归一化（`trim` / `upper` / `null` 收敛）
- 同一业务重试必须复用同一 `idempotency_key` 且 payload 完全一致
- 如业务语义变化（例如改单价），必须使用新的 `idempotency_key`

## 6. 失败语义约定

- `hash_conflict`：同 key 不同 payload，返回 409 语义错误（不可重试同 key）
- `in_progress`：同 key 正在处理中，返回可重试提示
- `permanently_failed`：该 key 已永久失败，需更换 key 或人工处理
- `not_current_claim`：claim token 过期或被回收，按 stale-claim 路径处理

---

参考：

- `src/lib/idempotency.ts`
- `supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql`
- `supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql`

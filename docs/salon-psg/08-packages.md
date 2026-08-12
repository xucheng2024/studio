# 8. 套餐管理

套餐与 Salon 业务关系较强，也是本产品保留的正式商用模块。现有 `packages`、`client_packages`、公开购买页、HitPay 付款、Booking 扣减和取消返还逻辑继续使用；PKG-01/02 的目标是渐进升级现有能力，不新建一套互不相通的套餐系统。

## 8.1 现有代码基线与限制

当前已经具备：

- `packages`：Studio、单一 Location、名称、次数、价格、有效期、类型、上下架和分享链接。
- `client_packages`：按登录用户保存剩余 Credits、到期日和购买快照。
- `/dashboard/packages` 与公开 Packages 页面：建立、编辑、停用、分享和购买 Class Pass。
- `/api/package/buy`、`payments`、HitPay Webhook/同步：建立付款并在 Paid 后发放 `client_packages`。
- Class Booking RPC：校验门店、到期日和余额，按 FEFO 扣减；按规则取消时返还 Credits。
- `/api/package/use` 已禁用人工直接扣减，避免从旧 HTTP 入口任意修改余额。

当前限制：

- `packages.type` 主要面向 `class_pack`，没有 Salon Service 适用关系或组合权益。
- `client_packages.client_id` 使用既有登录用户身份，尚未统一到 `salon_customers`；Guest、历史用户和合并客户需要迁移报告。
- `credits_left` 会被 RPC 直接更新，没有完整 append-only Ledger、金额余额和来源唯一约束。
- Package Paid、Booking consume/return、Refund 和人工调整尚未统一使用 FND-04 claim token 与强审计。
- 现有购买直接建立 `payments`，还没有统一的 POS Sale/Item，因此不能可靠形成多项目销售、退款分摊和 deferred income 报表。

## 8.2 实施顺序与兼容原则

1. 先完成 POS-01 的 Sale/Item 业务事实和价格快照契约。
2. PKG-01 在现有表上增加 Salon Service 适用范围、Customer 关联和 Ledger；不得删除现有 Class Pass 或改变历史余额。
3. 将每笔现有有效 `client_packages.credits_left` 迁移为一条 `opening_balance` Ledger，并输出无法映射到 `salon_customers` 的冲突报告。
4. 保留 `/api/package/buy` 和公开购买体验，但内部改为建立 Package 类型的 POS Sale Item；只有统一付款结算确认 Paid 后才能发放权益和 Ledger。
5. Class Booking 继续可使用原 Class Pass；Salon Appointment 只使用明确适用于所选 Service/Location 的套餐。
6. POS-02/03 可与 PKG-01 并行开发，但 Package Cash/HitPay 购买的端到端 Gate 必须在两边完成后共同验收。
7. PKG-02 增加人工调整审批；在 PKG-01/02 完成前不能申报 Q11/Q12 为 Yes。

迁移必须可回滚、可重跑并保留购买快照。上线期间新旧代码并存时，只允许一个数据库结算函数改变余额，禁止双写后各自扣减。

## 8.3 最小功能范围

- 套餐次数、价格、促销折扣和有效期
- 套餐适用服务和门店
- 客户套餐余额
- 购买、使用、返还、过期和退款记录
- 人工增加或扣减次数
- 员工提交调整原因
- 经理审批或拒绝
- 调整前后余额和完整操作记录

完成后 Q11 和 Q12 可以回答 Yes。未完成审批和审计流程前，不能申报为完整 Package Management。

第一版优先支持单服务 N 次套餐及既有 Class Pass。复杂多服务组合、家庭共享、套餐转让、自动续费和储值钱包后置，避免把次数套餐与可提现货币余额混为一谈。

## 8.4 余额与价值唯一口径

- `client_packages.credits_left` 是当前余额缓存，所有变化必须同时产生不可修改的 Ledger Entry。
- 购买产生 `purchase` Entry，预约使用产生 `consume` Entry，按规则取消产生 `return` Entry，退款产生 `refund_reversal` Entry，人工调整产生 `manual_adjustment` Entry。
- 每个来源业务使用唯一键，重复 Webhook、重复取消或重复提交不能再次改变余额。
- 余额不得小于零；扣减、返还、Ledger 和 Audit 必须在同一个数据库事务完成。
- Salon Appointment 只可使用仍有效、余额充足、适用于所选服务和门店的套餐。
- 历史套餐名称、总次数、价格、有效期和适用范围保存购买快照，主档修改不能改变已售套餐。
- 每笔已售套餐保存原始售价、折扣、退款和每次权益的分摊价值；Package Balance Value（deferred income）由未消费 Ledger 数量及购买快照计算，不读取当前套餐价格。
- 旧 `credits_left` 只作为迁移期兼容缓存。完成切换后，任何写入必须由 Ledger 事务派生并校验，页面和报表不能各自计算另一套余额。

## 8.5 人工调整审批

状态使用 `pending`、`approved`、`rejected` 和 `cancelled`：

1. Frontdesk 或 Manager 提交增加/扣减数量及原因。
2. 系统记录调整前余额和预计调整后余额，但 Pending 时不改变余额。
3. 有审批权限且不是原提交人的 Owner/Manager 批准或拒绝。
4. Approved 时锁定客户套餐，重新检查余额，再原子写入余额、Ledger 和 Audit。
5. 已审批记录不能编辑或删除；错误通过新的反向调整纠正。

第一版采用 maker-checker：同一人不能提交并批准同一调整。Owner 直接纠错也必须建立申请并由另一名有权限人员批准；如果商户只有一名管理员，应在申请前向 IMDA 确认是否允许 Owner 特批模式，不能由代码默认绕过审批。

## 8.6 数据和页面

新增：

- `client_package_ledger_entries`：余额变化、来源类型、来源 ID、变化数量、变化前后余额和操作人。
- `package_adjustment_requests`：申请数量、原因、状态、提交人、审批人及决定时间。
- `package_service_eligibility`：套餐可用服务。
- `package_location_eligibility`：套餐可用门店；空集合是否代表全部门店必须采用明确字段，不使用隐含规则。
- `client_packages.salon_customer_id` 或等价明确关联：新 Salon 套餐以 FND-02 Customer 为身份；原 `client_id` 在兼容期保留，不直接破坏现有 Class Booking。
- POS Package Sale Item 关联：保存购买来源、付款、退款和权益发放唯一来源，避免公开购买与前台销售形成两套财务事实。

页面：

- 现有 Packages 设置页增加服务、门店、有效期和销售快照设置。
- 客户详情显示当前套餐、到期日和完整 Ledger。
- `/dashboard/package-adjustments` 显示待审批、已批准和已拒绝申请。

## 8.7 权限和验收

- Customer 只能查看自己的套餐余额和历史。
- Frontdesk 可以提交调整，不能批准。
- Manager 只能处理授权门店相关申请，并遵守 maker-checker。
- Owner 可以查看全部门店和审计记录。
- 所有接口重新验证 Studio、Location、Customer 和 Package 关系。

提交前验证：旧 Class Pass 购买和预约不回退；迁移前后余额一致；Package Sale 只有 Paid 才增加余额；购买正确增加余额；预约只扣一次；按规则取消只返还一次；退款按未使用权益和既定规则产生反向 Ledger；余额不足不能预约；过期或不适用门店/服务的套餐不能使用；Pending/Rejected 不改变余额；Approved 产生一条 Ledger；并发购买、核销和审批只能成功一次；调整前后余额、未消费价值和操作者可完整追溯。

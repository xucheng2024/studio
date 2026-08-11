# 8. 套餐管理

套餐与 Salon 业务关系较强。现有 `packages`、`client_packages`、购买流程、Booking 扣减和取消返还逻辑可以复用，但现有功能主要服务课程 Credits，尚未形成可审计的 Salon Package Adjustment 流程。

## 8.1 最小功能范围

- 套餐次数、价格、促销折扣和有效期
- 套餐适用服务和门店
- 客户套餐余额
- 购买、使用、返还、过期和退款记录
- 人工增加或扣减次数
- 员工提交调整原因
- 经理审批或拒绝
- 调整前后余额和完整操作记录

完成后 Q11 和 Q12 可以回答 Yes。未完成审批和审计流程前，不能申报为完整 Package Management。

## 8.2 余额唯一口径

- `client_packages.credits_left` 是当前余额缓存，所有变化必须同时产生不可修改的 Ledger Entry。
- 购买产生 `purchase` Entry，预约使用产生 `consume` Entry，按规则取消产生 `return` Entry，退款产生 `refund_reversal` Entry，人工调整产生 `manual_adjustment` Entry。
- 每个来源业务使用唯一键，重复 Webhook、重复取消或重复提交不能再次改变余额。
- 余额不得小于零；扣减、返还、Ledger 和 Audit 必须在同一个数据库事务完成。
- Salon Appointment 只可使用仍有效、余额充足、适用于所选服务和门店的套餐。
- 历史套餐名称、总次数、价格、有效期和适用范围保存购买快照，主档修改不能改变已售套餐。

## 8.3 人工调整审批

状态使用 `pending`、`approved`、`rejected` 和 `cancelled`：

1. Frontdesk 或 Manager 提交增加/扣减数量及原因。
2. 系统记录调整前余额和预计调整后余额，但 Pending 时不改变余额。
3. 有审批权限且不是原提交人的 Owner/Manager 批准或拒绝。
4. Approved 时锁定客户套餐，重新检查余额，再原子写入余额、Ledger 和 Audit。
5. 已审批记录不能编辑或删除；错误通过新的反向调整纠正。

第一版采用 maker-checker：同一人不能提交并批准同一调整。Owner 直接纠错也必须建立申请并由另一名有权限人员批准；如果商户只有一名管理员，应在申请前向 IMDA 确认是否允许 Owner 特批模式，不能由代码默认绕过审批。

## 8.4 数据和页面

新增：

- `client_package_ledger_entries`：余额变化、来源类型、来源 ID、变化数量、变化前后余额和操作人。
- `package_adjustment_requests`：申请数量、原因、状态、提交人、审批人及决定时间。
- `package_service_eligibility`：套餐可用服务。
- `package_location_eligibility`：套餐可用门店；空集合是否代表全部门店必须采用明确字段，不使用隐含规则。

页面：

- 现有 Packages 设置页增加服务、门店、有效期和销售快照设置。
- 客户详情显示当前套餐、到期日和完整 Ledger。
- `/dashboard/package-adjustments` 显示待审批、已批准和已拒绝申请。

## 8.5 权限和验收

- Customer 只能查看自己的套餐余额和历史。
- Frontdesk 可以提交调整，不能批准。
- Manager 只能处理授权门店相关申请，并遵守 maker-checker。
- Owner 可以查看全部门店和审计记录。
- 所有接口重新验证 Studio、Location、Customer 和 Package 关系。

提交前验证：购买正确增加余额；预约只扣一次；按规则取消只返还一次；余额不足不能预约；过期或不适用门店/服务的套餐不能使用；Pending/Rejected 不改变余额；Approved 产生一条 Ledger；并发审批只能成功一次；调整前后余额和操作者可完整追溯。

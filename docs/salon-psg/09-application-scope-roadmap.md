# 申请范围与开发路线

## 一、现有功能的保留与申报边界

### 建议纳入 PSG 套餐

- Appointments
- Multi-outlet Management
- Customer Management
- POS 和 Payments
- Marketing Campaign
- HR、Commission 和自建 Payroll
- Reports 和 Dashboard
- Packages（完成审批和审计流程后）

### 可以保留，但不作为本次申请卖点

- **Memberships**：可以继续使用；不能把它描述成 Loyalty 或 Payroll。
- **Shop**：可以继续销售商品；不能把简单的库存数量描述成完整 Inventory Management。
- **Member Zone**：可以保留为普通附加功能，与本次 Salon 审核无关。
- **现有课程和活动**：可以保留，但 Salon 审核使用新的 Appointment 功能演示。

这些功能不需要从代码中删除。应通过产品套餐、功能权限、报价项目和合同条款清楚区分，避免客户把非资助附加模块计入 PSG 申报金额。

如果 IMDA 不接受“同一产品中的非资助附加模块”这种划分，再通过功能权限让 PSG 客户账号只启用获批模块。提交前应取得书面确认，不能自行假设。

### 本次不建议申报为 Yes

- Loyalty Points
- 完整 Inventory Management
- Mobile App
- AI
- IRAS AIS
- Leave、Attendance 和 Roster

申请表建议：

- Q9 Loyalty：No
- Q11 Package Management：完成审批和审计功能后填 Yes
- Q18 IRAS AIS：No
- Q19 Leave、Attendance、Roster：No
- Q20 Inventory：No
- Q24 Mobile App：No
- Q26 AI：No

报价、合同、产品说明和技术演示必须使用同一个 Salon PSG Core Edition。非资助附加模块必须单独列明，不能混入 PSG 资助报价。

## 二、开发顺序

### 第一阶段：确认申请风险

1. 保存 Q16 为 OR、Q17 接受自建 Payroll 且 Q18 No 不影响 Q17 的回复截图、身份、日期和完整上下文
2. 确认 PWA 是否会被视为 Mobile App；如未确认，本次填 No
3. 确认现有 Membership、Shop 和 Member Zone 能否作为非资助附加模块保留
4. 确认最终 PSG Core Edition 包含的模块和报价：Q16 仅 Email E-Marketing，不含 SMS/WhatsApp
5. 确认申请主体是 Product Principal 还是 Reseller，并选择 Q31 或 Q34 路径
6. 提前联系合资格第三方取得 VA/PT 范围、报价和排期，最终测试必须在主要功能稳定后进行
7. 规划 Cyber Essentials for ICT Vendors 或认可的等效认证，避免 Annual Review 时不符合要求

### 第二阶段：核心 Salon 功能

1. 统一 Employee 身份及员工多门店归属
2. 统一 Salon Customer 身份及现有客户迁移
3. 多门店服务发布和业务归店规则
4. 员工工作时间、房间和设备管理
5. Appointment 预约、状态和冲突事务
6. 客户健康资料、疗程记录和敏感权限
7. 自动预约提醒

### 第三阶段：运营功能

1. 建立统一 POS Sale/Cart，让 Service、Product 和 Package 共用销售事实
2. 在保留现有 Class Pass、公开购买和历史余额的前提下，完成套餐 Ledger、Salon Service/Location、调整审批和审计
3. 完成 Cash/HitPay、收据，并让客户自助预约支持 Package Credits、订金或全额付款
4. 完成员工佣金规则、退款/作废、套餐和佣金反向记录及日结
5. 完成营销 Campaign
6. 完成自建 Payroll、工资单和法定项目计算

### 第四阶段：报表和申请材料

1. 建立至少四个互动图表
2. 完成 CSV、XLSX、XML 和 TSV 业务数据导出
3. 完成 PDPA 控制、证据和官方 Personal Data Protection Requirements Form
4. 准备完整演示数据
5. 按 Q1–Q35 实际答题路径准备截图和附件
6. 准备样本报表、使用记录和客户证明
7. 完成正式环境安全加固和内部检查
8. 由合资格第三方完成 VA/PT，修复发现并取得最终报告
9. 完成一次完整的内部技术演示

详细任务编号和依赖关系见 [开发任务清单](./10-development-backlog.md)，逐任务范围、Gate 和剩余工作量见 [完整实施主计划](./16-complete-implementation-plan.md)，真实进度见 [实施状态表](./15-implementation-status.md)。未完成前置任务时，不应让编码代理并行实现依赖它的数据表或业务流程。

## 三、最终技术演示流程

技术演示应使用一条完整业务流程：

1. 建立两家门店
2. 建立员工、服务、房间和设备
3. 将服务发布到指定门店
4. 前台通过 POS 向客户销售套餐并以 Cash/HitPay 收款，展示 Paid 后才发放权益
5. 客户使用适用的 Package Credit 建立预约，并展示 Terms 接受和重复扣减保护
6. 展示系统自动发送预约确认和提醒
7. 客户到店并完成服务，前台对额外项目收款并开具收据
8. 更新客户疗程记录并查看套餐余额、Ledger 和未消费价值
9. 系统计算员工佣金
10. 演示套餐调整申请、审批和审计记录
11. 演示退款后套餐/佣金反向记录和 Credit Note
12. 在 Dashboard 查看预约、销售、客户、套餐价值和员工业绩

所有申请表中勾选 **Yes** 的功能，都必须能够在正式版本中现场操作，不能只展示设计图或未来开发计划。

## 四、预计工作量

按当前完整 Q1–Q35 范围，并移除 SMS/WhatsApp 后，整体预计约为 **32–47 个工程师周**。一名全职开发者约需 8–11 个月；两名熟悉项目的开发者在完成共同基础后合理并行，约需 5–7 个月。该估算包含开发、Migration、权限和基本测试，不包含外部等待时间。

在 FND-01、FND-02、FND-03 已上线的当前基线上，主计划重估剩余约 **27–40 个工程师周**。每个 Phase 完成后应以实际交付速度重新估算。

主要不确定因素：

- 新加坡 Payroll 会计师或专业顾问的规则验证时间
- 第三方服务的测试和正式环境审批
- VA/PT 供应商排期、发现修复和复测时间
- Cyber Essentials 或认可等效认证的组织准备时间
- 申请截图、客户案例和技术演示准备时间

## 五、完成标准

满足以下条件后再提交申请：

- 所有强制问题都能真实回答 Yes
- 所有 Yes 项目都有对应系统截图
- 所有 Yes 项目都能在正式版本现场演示
- PSG 报价、合同、产品说明和演示版本完全一致
- 非资助附加模块已与 PSG 报价清楚分开，并获得 IMDA 对申报边界的确认
- 已准备至少 5 家目标行业 SME 的合资格客户证明
- 已完成正式环境测试、权限检查和数据保护检查
- 已完成 Q28 所需业务数据导出格式和权限验证
- 已提交 Q29 指定的 Personal Data Protection Requirements Form，并备齐系统证据
- 已取得提交日前 12 个月内、覆盖规定范围且由合资格第三方出具的 VA/PT 报告

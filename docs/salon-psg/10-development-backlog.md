# Salon PSG 开发任务清单

任务按依赖顺序排列。编码代理一次只领取一个任务；只有依赖全部完成并验证后，才能开始下一层任务。具体字段和验收场景以对应模块文档及 `tasks/TASK-ID.md` 为准；进度只看 `15-implementation-status.md`。

## Phase 0：共同基础

### FND-01 统一 Employee 身份

依赖：无。新增 `employees`、`employee_locations` 及登录账号/Instructor 关联；迁移现有员工数据；区分访问权限与实际工作门店。完成后员工可以跨店工作，旧账号权限不变，异常关联有迁移报告。

### FND-02 统一 Salon Customer 身份

依赖：无。新增 `salon_customers`，迁移现有 Studio Members，扩展 Guest Merge，并建立重复提示及人工合并基础。不得迁移或猜测健康资料。

### FND-03 服务与门店发布

依赖：FND-01。实现 `service_locations`、全部/指定门店发布、门店停用、总部默认值及价格/时长/缓冲覆盖值；数据库验证 Service、Location、Studio 一致，并记录 before/after 审计。`service_employees` 不属于本任务，统一由 APT-01 实现。

### FND-04 强审计与幂等基础

依赖：无。建立关键业务可复用的 Audit、Provider Event 幂等和唯一来源约定；不替换现有普通操作日志，只用于资金、余额、佣金、敏感资料和 Payroll。

## Phase 1：Appointment 与客户服务

### APT-01 工作时间和资源设置

依赖：FND-01、FND-03。实现 `service_employees`、营业时间、员工工作时间/例外、房间床位设备和服务资源要求，以及对应设置页面和权限；员工必须在 Appointment 门店有有效工作归属并获授权提供所选服务。

### APT-02 Appointment 原子事务

依赖：APT-01、FND-02、FND-04。建立 Appointment、资源占用、状态历史和原子创建/改期/取消 RPC；覆盖并发冲突、Pending 到期和跨门店员工冲突。

### APT-03 后台日历和状态操作

依赖：APT-02。实现日/周日历、创建、确认、Check-in、开始、完成、取消、爽约和权限范围。

### CRM-01 健康资料和敏感权限

依赖：FND-02。实现偏好、健康、过敏、禁忌、Consent、查看审计和客户详情分区；验证跨 Studio 隔离和普通导出排除。

### CRM-02 Treatment 与 Follow-up

依赖：APT-03、CRM-01。Completed Appointment 建立/关联 Treatment，支持修订、实际员工、跟进日期和 Follow-up Queue，但不在此任务生成佣金。

### APT-05 预约通知

依赖：APT-03。实现 Email 确认、提醒、变更、取消任务和幂等 Cron；SMS 不属于本次范围。

## Phase 2：POS、套餐、自助预约与佣金

### POS-01 销售主单和购物车

依赖：FND-01、FND-02、FND-03、FND-04。实现 `pos_sales`、多项目 `pos_sale_items`、客户/门店/员工归属、价格快照、折扣分摊和权限校验；Service、Product、Package 共用一套销售事实。现有 `/api/package/buy` 保留为单 Package 在线销售入口，但内部逐步接入 POS Sale/Payment。

### PKG-01 套餐 Ledger

依赖：FND-02、FND-03、FND-04、POS-01。渐进升级现有 `packages` / `client_packages`：保留 Class Pass、公开购买和历史余额，为购买、使用、返还、退款和过期建立不可修改 Ledger，接入 Salon Customer、Service/Location 适用范围，并将当前余额迁移为可核对的 opening balance。

### POS-02 Cash 收款和收据

依赖：POS-01。实现原子 Cash 付款、找零、Payment 关联、商品扣库存、多项目 Receipt 和重复提交保护；Package Item 只有 Paid 后才发放权益。

### POS-03 HitPay 收款

依赖：POS-01。实现 Pending Payment Request、Webhook/主动同步、签名和幂等；只有服务端确认 Paid 才完成销售、库存、Package 权益和收据。可与 PKG-01 并行，但 Package 购买联合 Gate 需两者均完成。

### PKG-02 套餐调整审批

依赖：PKG-01。实现 maker-checker 申请、批准、拒绝、并发保护、审计和客户 Ledger 页面。

### APT-04 客户自助预约

启动依赖：APT-03、CRM-01；最终上线依赖：PKG-01、POS-03。先实现安全登录后的实时可用时段、客户预约/查看/改期/取消和 Terms 版本证据，再接 Package Credits、在线全款和订金。Guest 仅由 Frontdesk 建立，不作为自助演示。

### COM-01 佣金规则和入账

依赖：POS-02、POS-03、CRM-02。实现员工/服务佣金规则和唯一来源 Entry。只有 Completed Appointment 或受审计 Walk-in `fulfilled_at` 证明服务完成，且 POS Service Item Paid 后才 Earned；不能由 Appointment 和 POS 各生成一次。

### POS-04 退款、作废和日结

依赖：COM-01、PKG-01。实现整单/明细/部分退款、库存回补、Package 反向 Ledger、佣金反向 Entry、Credit Note、作废、Cash Session 和每日汇总。

## Phase 3：Marketing 与 Payroll

### MKT-01 分组和 Email 内容

依赖：FND-02、CRM-01、POS-04。实现 VIP/常客/长期未到店分组、收件人快照、固定模块编辑器、Resend 独立发送和一键退订。

### MKT-02 调度、Webhook 和报告

依赖：MKT-01、FND-04。实现分批 Cron、Resend Webhook、Delivery/Suppression、签名点击链接和成功率/点击率报告。

### PAY-01 员工薪资档案和规则版本

依赖：FND-01、COM-01，且 Payroll 专业规则已确认。实现 Compensation Profile、带生效日期的法定规则和严格 Payroll 权限；未确认的规则不得自行猜测写死。

### PAY-02 Payroll Run 和审批

依赖：PAY-01。实现 Draft、Reviewed、Approved、Paid、Voided，工资行快照、佣金汇总、强审计和不可直接修改规则。

### PAY-03 Payslip 和报表

依赖：PAY-02。实现 MOM Itemised Payslip PDF、员工本人查看、Email、Payroll/CPF/SDL/SHG/Commission 报表及 CSV。

## Phase 4：Dashboard 和申请验收

### RPT-01 统一 Reporting Facts

依赖：APT-03、POS-04、COM-01、PKG-01。建立数据库 View/Function 和索引，统一 Appointment、Service/Retail/YoY Sales、Customer Retention/FOV、Commission 和 Package Balance Value 口径，不再读取固定 5,000 笔明细计算。

### RPT-02 四图 Dashboard

依赖：RPT-01。实现四个图表、日期/门店/员工/服务公共筛选、KPI、明细、响应式表格替代和权限测试；提供 Q3 所需 Outlet/Service/Retail/YoY Sales、New/Repeat Retention、FOV、Employee/Commission 和 Package Value 报表，并明确 Inventory/Loyalty 为 0。

### EXP-01 多格式业务数据导出

依赖：RPT-01、CRM-02、POS-04、PKG-02、PAY-03。建立统一 Export Service，让授权用户按相同筛选导出 CSV、XLSX、XML 和 TSV；验证文件格式、数据权限、敏感字段排除和大数据量处理，满足 Q28。

### CMP-01 PDPA 产品控制和申请证据

依赖：CRM-01、FND-04。完成隐私告知/Consent 版本、访问与更正请求、受控导出、保留期限、删除/匿名化、敏感访问审计和 Processor/第三方清单所需产品能力；由负责人填写 Q29 指定的官方 PDPA Form。编码代理不能代替 DPO 作法律确认。

### SEC-01 VA/PT 准备、外部测试和修复

依赖：全部申报功能进入稳定测试环境。先进行内部安全检查和修复，再由符合 Q30 资格的独立第三方完成网络、应用、数据保护、访问控制、API、Cloud Configuration 和 OWASP Top 10 测试。取得报告后修复/缓解发现并保存复测证据。编码代理只能协助准备和修复，不能自行出具合格的第三方报告。

### ORG-01 Cyber Essentials 路径

依赖：申请主体确认。Product Principal 走 Q31–Q33，Reseller 走 Q34–Q35；由公司负责人推进 Cyber Essentials for ICT Vendors、Cyber Trust Mark、ISO 27001 或官方认可等效认证。该任务主要是组织认证，不是产品代码。

### PSG-01 演示数据和证据

依赖：全部申报为 Yes 的任务，以及 EXP-01、CMP-01、SEC-01。建立可重复执行的演示 Seed、Q1–Q35 实际答题路径截图清单、样本报表和端到端演示脚本；不得用手工改库制造演示结果。

## 并行规则

- FND-01、FND-02、FND-04 可以并行，但必须先共同确认统一 ID 和 Audit 约定。
- APT-01 与 CRM-01 可以在基础任务完成后并行。
- POS 与 Appointment 页面可以分团队开发，但必须共用 Customer、Employee、Location 和 Service 数据契约。
- Marketing Email 可以在 POS 完成前搭建编辑器，但正式 VIP/常客数据和验收必须等待真实销售事实。
- Dashboard 最后实现；提前做会导致查询口径随前置表变化而反复返工。

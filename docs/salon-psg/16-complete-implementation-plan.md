# Salon PSG 完整实施主计划

本计划把全部 Salon PSG 产品需求拆成可由 Codex、Claude、Cursor 或人工开发者逐项领取的任务。它不替代模块需求，而是确定实施顺序、任务边界、交付物和进入下一阶段的 Gate。

当前状态以 [实施状态表](./15-implementation-status.md) 为准；详细业务字段和流程以 `01–08` 模块文档为准；申请完成条件以 [Q1–Q35 对照表](./11-q1-q35-application-matrix.md) 为准。

## 1. 执行规则

每次只实施一个任务编号，并执行以下流程：

1. 从 `tasks/TASK-TEMPLATE.md` 建立或更新 `tasks/TASK-ID.md`。
2. 固定本次 In Scope、Out of Scope、依赖、Migration/回填和权限矩阵。
3. 先实施数据库约束、索引、RLS、RPC和迁移，再做服务端和必要页面。
4. 所有 Mutation 在服务端重新检查 Studio、Location 和角色；数据库同时保证跨表租户一致。
5. 按任务文件执行 Migration、允许/拒绝、并发/幂等、TypeScript 和相关 Lint/Test。
6. 只有保存了实际验证结果，状态才能从“已实现/待验证”进入“已验证/待上线”。
7. 完成后停止，不自动开始下一任务，不提交、不推送、不执行生产 SQL，除非当次指令明确授权。

## 2. 数据契约冻结

- Employee 只使用 FND-01 的 `employees` / `employee_locations`；`staff_memberships` 只负责登录权限。
- Customer 只使用 FND-02 的 `salon_customers`；健康和疗程数据通过外键扩展，不另建客户身份。
- Service 总部主档只使用 `studio_services`；门店可用性只使用 FND-03 的 `service_locations`。
- 实际 Appointment、POS、Payment、Treatment、Commission 必须保存 `studio_id` 和有效 `location_id`，并保存必要快照。
- 关键资金、余额、状态、佣金和 Payroll 写入必须原子、幂等并有不可抵赖审计。
- HitPay 与 Resend 均为 Studio BYOK：租户付款和商户邮件使用该 Studio 自己的密钥；平台环境变量不得作为未配置 Studio 的静默回退。

## 3. Phase 0：共同基础

### FND-01 Employee Foundation — 已上线

- 交付：Employee 主档、多门店归属、Primary Location、用户/Instructor 关联和迁移冲突。
- 非目标：排班、服务资格、佣金、Payroll。
- Gate：后续任务只扩展现有身份，不重新实现。详见 `tasks/FND-01.md`。

### FND-02 Customer Foundation — 已上线

- 交付：Salon Customer 主档、Guest/Member 兼容、重复提示、Merge 和迁移冲突。
- 非目标：健康资料、Treatment、Marketing Consent。
- Gate：后续任务只扩展现有身份。详见 `tasks/FND-02.md`。

### FND-03 Service/Location Publishing — 已上线

- 交付：全部/指定门店发布、停用、覆盖值、传播模式、审计和 Scoped Server Library。
- 非目标：`service_employees`、Appointment、POS、Package、页面大改造。
- Gate：已由 Commit `6c40e3d` 上线，Migration 回填 47 条关系。总部默认时长/缓冲明确由 APT-01 补充。详见 `tasks/FND-03.md`。

### FND-04 强审计与幂等基础

- 依赖：无，但必须兼容 FND-01 至 FND-03 已有审计。
- 必做：定义关键业务 Audit Envelope、不可修改审计、Provider Event 去重、业务幂等键、唯一来源约束和复用服务端接口。
- 非目标：替换普通内容操作日志；实现任何 Appointment、Payment、Package、Commission 或 Payroll 业务。
- 验收 Gate：重复事件不能产生第二笔业务事实；关键审计不能被普通员工修改/删除；权限和并发测试通过。

### Phase 0 Gate

- FND-01、FND-02 已上线且不回退。
- FND-03 已上线，后续任务不得重做服务门店关系。
- FND-04 可供后续事务复用。
- 预计剩余工作：约 1–2 工程师周，主要是 FND-03 收口和 FND-04。

## 4. Phase 1：Appointment 与客户服务

### APT-01 服务资格、可用时间和资源

- 依赖：FND-01、FND-03。
- 必做：`service_employees`、门店营业时间、员工常规工作时间/例外、房间/床位/设备、服务资源要求、标准服务时长和缓冲来源、设置权限。
- 非目标：创建 Appointment、日历、客户自助预约、通知。
- Gate：员工必须同时满足工作门店、服务资格和可用时间；资源及员工跨 Studio 组合由数据库拒绝。

### APT-02 Appointment 原子事务

- 依赖：APT-01、FND-02、FND-04。
- 必做：Appointment/占用/状态历史、原子创建改期取消、员工和资源冲突、跨店员工冲突、Pending 过期和 Terms 接受证据接口。
- 非目标：完整日历 UI、Customer Portal、Email。
- Gate：并发预约只能成功一笔；失败不留下部分占用；所有业务记录正确归店。

### APT-03 后台 Appointment 日历

- 依赖：APT-02。
- 必做：日/周视图、客户/服务/员工/门店/时间选择、确认、Check-in、开始、完成、取消、No-show、移动端状态和 Scoped 操作。
- 非目标：在线客户自助、Treatment、佣金、付款。
- Gate：Owner/Global Manager/Location Manager/Frontdesk 的允许范围正确，Instructor 只能按既定只读/本人范围操作。

### CRM-01 客户敏感资料和 Consent

- 依赖：FND-02。
- 必做：偏好、过敏、健康、禁忌、Marketing Consent、字段级权限、敏感查看/导出审计、数据隔离。
- 非目标：Treatment、Follow-up、Campaign 发送。
- Gate：健康信息不会进入普通列表、Marketing 或未授权导出；每次敏感查看有证据。

### CRM-02 Treatment 与 Follow-up

- 依赖：APT-03、CRM-01。
- 必做：Completed Appointment 关联 Treatment、实际员工、疗程记录修订历史、备注、跟进日期和 Queue。
- 非目标：生成付款或佣金、改写历史 Treatment。
- Gate：只有授权员工可读写；历史修订可追踪；未完成 Appointment 不能伪造 Completed Treatment 来源。

### APT-05 Appointment Email

- 依赖：APT-03。
- 必做：确认、提醒、变更、取消 Email，模板、时区、幂等队列/Cron、失败重试和发送证据；使用该 Studio 自己的 Resend 密钥，未配置则失败并显示 email provider not configured。
- 非目标：SMS、WhatsApp Campaign、Marketing Email、平台代付租户邮件额度。
- Gate：重复 Cron 不重复发送；取消/改期后的旧提醒不会发送；未配置 Studio 不得回退平台 `RESEND_*`。
- 依赖契约冻结（2026-08-12）：APT-03 状态机、资源释放和幂等重放结果已完成收口；APT-05 仅消费既有事务结果，不重定义状态转换。

### Phase 1 Gate

- 后台可以完成完整 Salon Appointment 流程，并自动发送确认、提醒、变更和取消 Email。
- Treatment 和敏感资料权限通过。
- 现有课程 Session 保留但不参与 Salon 演示。
- 自助预约的基础页面可并行启动，但 Package/Payment 联合上线 Gate 归入 Phase 2。

## 5. Phase 2：POS、Package、自助预约与 Commission

### POS-01 Sale 与购物车

- 依赖：FND-01、FND-02、FND-03、FND-04。
- 必做：`pos_sales`、`pos_sale_items`、客户/门店/员工、Service/Product/Package、价格快照、折扣及税额服务器重算、Walk-in 完成证据。
- 现有复用：`payments`、HitPay、Invoice、Service Order、Shop Order 及 `/api/package/buy` 保留；Package 公开购买逐步适配为单 Item POS Sale，不另建第二套销售事实。
- 非目标：实际 Cash/HitPay 扣款、退款、佣金和 Package Ledger。
- Gate：每单和每项都归属有效 Studio/Location；门店不可售项目被拒绝；客户端金额不受信任；历史订单不被伪造或覆盖。
- 依赖契约冻结（2026-08-12）：FND-04 的强审计、Claim/Complete/Fail 幂等 fencing、provider event dedup 为 POS-01 唯一可用基础契约。

### PKG-01 Package Ledger

- 依赖：FND-02、FND-03、FND-04、POS-01。
- 必做：渐进升级现有 `packages` / `client_packages`；保留 Class Pass、公开购买和历史余额，增加 Salon Customer、适用服务/门店、价格/次数/有效期/促销、购买/使用/返还/退款/过期 Ledger、余额同事务更新及 opening-balance 迁移。
- 非目标：人工调整审批、POS 支付实现。
- Gate：旧 Class Booking 不回退；余额等于 Ledger 汇总；重复来源不重复扣减；Paid Package Sale 才发放权益；迁移差异和无法映射 Customer 有报告；可计算未消费套餐价值。
- 依赖契约冻结（2026-08-12）：PKG-01 必须复用 POS-01 销售事实与 FND-04 强审计/幂等契约，不新增平行账本幂等模型。

### PKG-02 Package 调整审批

- 依赖：PKG-01。
- 必做：Maker-Checker 申请、批准、拒绝、并发保护、理由和完整审计。
- 非目标：一般客户 Merge 或 Loyalty Points。
- Gate：申请人不能批准本人申请；直接修改余额被数据库阻止。

### POS-02 Cash、Receipt

- 依赖：POS-01。
- 必做：现金原子收款、找零、Payment、商品数量、Receipt Number、PDF Receipt 和重复提交保护。
- 非目标：HitPay、退款、日结。
- Gate：Payment、Sale、库存、Package 权益及 Receipt 要么一起成功，要么一起失败。

### POS-03 HitPay

- 依赖：POS-01。
- 必做：Pending Request、签名 Webhook、主动同步、Provider Event 幂等、成功/失败/过期状态及正式 Receipt 触发。
- 非目标：Cash、部分退款、其他支付服务商。
- Gate：只相信服务端验证的 Paid；Webhook 重放不重复完成销售或发放 Package。

### APT-04 客户自助预约

- 启动依赖：APT-03、CRM-01；最终上线依赖：PKG-01、POS-03。
- 第一段：登录客户查看实时档期、预约、查看、取消、改期、T&C 展示和接受版本。
- 第二段：接入仅适用于所选 Salon Service/Location 的 Package Credit，或通过 POS/HitPay 支付订金/全额；现有 Class Pass 不自动获得 Salon 使用资格。
- 非目标：匿名 Guest 自助、SMS、复杂候补名单。
- Gate：客户只能操作本人预约；改期重新执行冲突检查；Package 扣减与预约建立同源幂等；付款失败或过期 Pending 自动释放。

### COM-01 Commission

- 依赖：POS-02、POS-03、CRM-02。
- 必做：员工/服务规则、有效期版本、Appointment/Walk-in 完成证据、Paid 条件、唯一来源 Commission Entry、退款反向 Entry 和报告基础。
- 非目标：Payroll Run、手工覆盖已入账原记录。
- Gate：完成与付款不论先后只生成一笔佣金；Appointment/POS 不能重复生成。

### POS-04 Refund、Void、Cash Close

- 依赖：COM-01、PKG-01。
- 必做：整单/明细/部分退款、Credit Note、作废规则、库存回补、套餐/佣金反向 Entry、Cash Session 和日结。
- 非目标：Accounting Ledger、IRAS AIS。
- Gate：退款不会覆盖原记录；所有反向业务有唯一来源和审计。

### Phase 2 Gate

- 前台能以 Cash/HitPay 完成 Service/Product/Package 多项目销售、Receipt、退款/作废和日结。
- 现有 Class Pass 和公开购买保持兼容，Salon Package 使用 Ledger、调整审批和 deferred value 唯一口径。
- 客户可以安全自助预约/改期/取消，并以合资格 Package、订金或全款完成资格检查。
- Package 与 Commission 在付款、服务完成和退款时保持一致。

## 6. Phase 3：Marketing 与 Payroll

### MKT-01 Audience 与 Email 内容

- 依赖：FND-02、CRM-01、POS-04。
- 必做：VIP/常客/长期未到店分组、Consent/Suppression、Recipient Snapshot、固定 Email Builder、图片/CTA、测试邮件和一键退订。
- 非目标：SMS、WhatsApp、AI 文案、复杂 Journey。
- Gate：没有有效 Email Consent 的客户永远不会进入可发送名单；健康资料不可作为分组或模板变量。

### MKT-02 调度、Webhook、报告

- 依赖：MKT-01、FND-04。
- 必做：立即/预约发送、分批 Cron、每个 Studio 自己的 Resend 账号（API key / From / webhook secret）、Resend ID/Webhook、Delivery/Bounce/Complaint、签名点击、重试、成功率和点击率。未配置的 Studio 不得回退平台 `RESEND_*`。
- 非目标：Open Rate 作为核心指标、多渠道计费、平台代付租户邮件额度。
- Gate：重复调度/Webhook 幂等；退订立即生效；Location Manager 不能营销其他门店客户；Webhook 验签绑定该 Studio 密钥。

### PAY-01 薪资档案和规则版本 — 已上线

- 依赖：FND-01、COM-01。
- 必做：复用已上线的 Employee、Location、Commission Entry 和强审计；按 `tasks/PAY-01.md` 只建立 Compensation Profile、Employee 本人 Email/电话更新、基本工资/时薪、CPF/SDL/SHG 等带官方来源和生效日期的规则、严格权限和敏感访问审计。
- 非目标：IRAS AIS、Leave/Attendance/Roster、官方资料无法确定的规则。
- Gate：官方规则来源和版本完整，边界案例与官方示例/计算器一致；普通 Manager/Frontdesk 无工资权限。专业人士复核不是硬 Gate。

### PAY-02 Payroll Run 与审批 — 已上线

- 依赖：PAY-01。
- 必做：Draft/Finalised/Paid/Voided、员工工资行/规则快照、现有 Commission Entry 唯一锁定、扣款/贡献和强审计。
- 非目标：Reviewed/Approved 双层状态、Maker-Checker；第一版由 Owner Finalise。
- 非目标：银行 GIRO、IRAS 提交。
- Gate：Finalised 后不能静默重算；规则或员工变化不改历史 Run。

### PAY-03 Payslip 与报告 — 已上线

- 依赖：PAY-02。
- 必做：MOM Itemised Payslip 打印/PDF、员工本人查看、Payroll Summary、Commission Report、合并 Statutory Contribution Summary，并复用 Q28 四格式导出。
- 非目标：Payslip Email 发送、IR8A/AIS 自动提交。
- Gate：员工只能查看本人 Payslip；Payroll 管理员按严格范围查看；样本字段与 MOM 官方清单逐项一致。

### Phase 3 Gate

- Q16 完整 Email E-Marketing 可演示，不依赖 SMS；演示 Studio 使用自己的 Resend 账号，平台不代付发送额度。
- Q17 自建 Payroll 档案、跑批、Payslip 和报告已上线。Q18 保持 No。
- 预计剩余工作转入 Phase 4；外部 Payroll 复核为可选项，不计入交付 Gate。

## 7. Phase 4：Reports、Compliance 和申请收口

### RPT-01 Reporting Facts

- 依赖：APT-03、POS-04、COM-01、PKG-01。
- 必做：复用现有 Revenue Summary、Deferred Value RPC 和 Commission Entry，只为缺口补 Appointment、Sales、Customer Retention/FOV 和 Employee Productivity 的 View/Function/索引。
- 非目标：图表 UI、重新定义业务状态。
- Gate：单店之和等于 All Locations；历史未分配数据单列；大数据不依赖固定条数客户端计算。

### RPT-02 四图 Dashboard

- 依赖：RPT-01。
- 必做：一个证据 Dashboard，固定为 Appointment Outcome、Sales Trend、Revenue by Service、Employee Commission/Productivity 四图；日期、门店、员工、服务中至少三个公共筛选作用于全部四图，并提供明细/响应式替代。
- 非目标：Inventory/Loyalty 假数据、第二套报表口径。
- Gate：所有图表同时响应筛选并严格执行 Location Scope。

### EXP-01 多格式导出

- 依赖：RPT-01、CRM-02、POS-04、PKG-02、PAY-03。
- 必做：扩展现有 Deferred 四格式 builder，让 Sales、Customers、Packages 和 Payroll/Commission 按页面相同筛选和权限导出 CSV、XLSX、XML、TSV；统一敏感字段排除和行数上限。
- 非目标：后台异步大文件任务、任意数据库 Dump、每个页面单独建设导出器、绕过 Payroll/健康权限。
- Gate：四种格式可打开、内容一致、越权和敏感字段测试通过。

### CMP-01 PDPA 控制和证据

- 依赖：CRM-01、FND-04。
- 必做：Privacy Notice/Consent 版本、访问更正请求、受控导出、保留/删除/匿名化、Processor 清单证据和敏感访问审计。
- 非目标：编码代理作法律结论或代填负责人声明。
- Gate：公司 DPO/负责人核对并完成指定 PDPA Form。

### SEC-01 VA/PT

- 依赖：所有申报 Yes 功能进入稳定测试环境。
- 必做：内部准备、范围清单、外部合资格第三方测试、发现修复、复测和报告证据。
- 非目标：内部扫描冒充第三方报告。
- Gate：报告在有效期内，重要发现已修复或有正式接受的缓解。

### ORG-01 Cybersecurity Certification

- 依赖：申请主体 Product Principal/Reseller 身份确认。
- 必做：由公司推进认可认证路径、证书范围和 Annual Review 计划。
- 非目标：产品代码代替组织认证。
- Gate：Q31–Q35 答题路径和证明材料与真实身份一致。

### PSG-01 演示和证据

- 依赖：全部计划回答 Yes 的任务、EXP-01、CMP-01、SEC-01。
- 必做：可重复 Seed、Q1–Q35 截图清单、样本报表、报价/合同范围核对、端到端演示脚本和一次完整彩排。
- 非目标：手工改数据库制造结果、用设计图代替功能。
- Gate：所有 Yes 功能在生产等效环境可操作，证据、报价、合同和演示完全一致。

### Phase 4 Gate

- 产品 Gate、数据导出、PDPA、VA/PT、组织答题和申请材料全部完成。
- 预计剩余产品及证据工作：约 2–4 工程师周（CMP-01 / PSG-01）；外部 VA/PT 和认证排期另计。

## 8. 建议并行路径

- FND-04 完成后：APT-01 与 CRM-01 可并行。
- APT-03 完成后：APT-05 可与 CRM-02 并行。
- POS-01 完成后：PKG-01、POS-02 与 POS-03 可并行；Package 购买结算必须联合验收。
- APT-04 的登录/实时档期部分可在 APT-03、CRM-01 后提前开发，Package/Payment 部分等待 PKG-01、POS-03。
- MKT 编辑器可先做结构，但真实分组验收必须等待 POS-04。
- ORG-01 和 VA/PT 询价可提前推进；正式 VA/PT 必须等待主要功能稳定。
- RPT-01、RPT-02、EXP-01 已上线。剩余 Phase 4 为 CMP-01、SEC-01、ORG-01、PSG-01。

## 9. 总体工作量和完成定义

截至 2026-08-18，Phase 0–3 与 Phase 4 产品项（RPT-01、RPT-02、EXP-01）已上线。按本次收缩后的剩余范围，约 **2–4 个工程师周**：

- CMP-01、PSG-01 产品控制与证据：约 2–4 周

这是熟悉项目的工程师投入估算，包含 Migration、权限和针对性测试，不包含外部 VA/PT、组织认证和 IMDA 审核等待。Payroll 专业复核不是硬 Gate。每完成一个任务后按实际速度重估。

最终“全部完成”不是指代码任务全部有文件，而是同时满足：

- `15-implementation-status.md` 中所有计划回答 Yes 的产品任务均已上线。
- Q1–Q35 对照表的每个 Yes 都有真实功能和证据。
- Q16/Q17 口径、Q29 表格、Q30 VA/PT、Q31–Q35 身份/认证全部关闭。
- 报价、合同、正式产品和演示使用同一 PSG Core Edition 范围。
- PSG-01 端到端彩排通过，没有使用手工改库或未来功能描述。

# 7. 员工、佣金和薪资

本项目建议自行实现第一版新加坡基础 Payroll，让“服务完成、计算佣金、生成工资单”成为 Salon 产品的完整流程。第一版不做 IRAS AIS，Q18 回答 No。

## 7.1 结合现有系统的改造原则

现有代码可以复用：

- `staff_memberships`：继续负责 Owner、Manager、Frontdesk、Instructor 的登录权限和门店范围。
- `locations`：继续作为员工所属门店和 Payroll 报表筛选条件。
- `studio_services`、`service_orders`、`payments`：作为服务销售和佣金数据来源。
- `operation_audits`：保留普通操作日志；Payroll 另外建立不可跳过、不可修改的专用审计记录。
- 现有 PDF 和 Email 基础：复用来生成及发送工资单，但使用独立的 Payslip 模板。

当前需要解决的代码缺口：

- `staff_memberships` 只是系统权限，不包含员工雇佣和薪资资料。
- `instructors` 与登录用户、员工档案尚未形成统一员工身份。
- `service_orders` 当前没有服务员工和服务门店，无法准确计算佣金。
- 现有通用 Audit 是 best-effort，写入失败不会阻止业务；Payroll 审计必须强制成功。
- 现有 RBAC 没有独立 Payroll 权限，不能让普通 Manager、Frontdesk 或 Instructor 查看全员工资。

因此，应新增统一的 Employee 档案，并分别关联登录账号、员工权限和 Instructor 身份，不直接把工资字段塞进 `staff_memberships`。

## 7.2 员工资料

Owner 可以建立和管理：

- 员工姓名、员工编号和联系资料
- 出生日期
- 国籍和居民身份
- PR 生效日期和 PR 年度
- 入职、离职日期
- 所属门店和职位
- 月薪、时薪或日薪类型
- 基本工资
- CPF、SDL、SHG 是否适用
- 默认津贴和扣款
- 默认佣金方案
- 员工状态

员工登录后只能查看自己的资料和工资单，并可以更新电话号码、地址、紧急联系人等非薪资资料。基本工资、身份、CPF 设置和佣金规则只能由 Owner 修改。

## 7.3 服务员工和佣金

Appointment、POS 和 `service_orders` 必须保存：

- 服务员工
- 服务门店
- 服务完成时间
- 服务原价、折扣和实际净销售额
- 退款金额
- 佣金计算状态

佣金规则至少支持：

- 固定金额佣金
- 按实际服务销售额百分比
- 不同员工使用不同佣金方案
- 不同服务使用不同佣金比例
- 退款后撤销佣金，或在下一工资周期冲回
- Owner 手工调整佣金，但必须填写原因并经过审批

COM-01 第一版业务口径冻结为：

- 如果在佣金计算时点没有找到对应员工/服务的生效规则，视为该服务不适用佣金（佣金为 0）。系统返回 `rule_not_found` 并跳过分录，不创建零金额 Entry、不阻断 POS 付款，也不因为以后新增规则而自动追溯补发。
- 百分比佣金的基数固定为 `pos_sale_items.total_amount`，即 POS Service Item 折扣后的实际成交总额。后续部分或全额退款不改写原 earned Entry，而是按 `refunded_amount / total_amount` 比例追加 `refund_reversal` Entry；累计冲销不得超过原佣金。

只有存在服务完成证据且对应 POS Service Item 已经 Paid，佣金才进入 Earned。预约服务以 Completed Appointment 为完成证据；无预约 Walk-in 以 POS/Service Order 中受审计的 `fulfilled_at` 为完成证据。Appointment 完成不能单独产生佣金，POS 付款也不能为未完成服务提前产生佣金。

每笔原始佣金以 POS Service Item 作为唯一来源，并同时追溯 Appointment、Service Order 和 Payment。数据库必须限制同一 POS Service Item 最多生成一笔原始佣金；退款和人工调整使用新的反向/调整 Entry，不能覆盖原记录或只保存最终总数。

## 7.4 Payroll Run 流程

每个月的 Payroll 必须按照以下状态流转：

1. **Draft**：系统汇总基本工资、佣金、津贴、奖金、加班和扣款。
2. **Reviewed**：Owner 检查计算结果并处理异常。
3. **Approved**：工资正式确认，保存全部计算快照并锁定。
4. **Paid**：记录发薪日期和付款参考编号。
5. **Voided**：发现错误时作废原工资，保留原记录，再建立更正版本。

Approved 或 Paid 后不能直接修改金额。任何更正必须保留原始版本、修改原因、操作者、审批人和时间。

## 7.5 薪资计算项目

第一版至少支持：

- 基本工资
- 不足月工资
- 固定及临时津贴
- 奖金
- 服务佣金
- 加班时数和加班工资
- 无薪假、缺勤和其他合法扣款
- 员工 CPF
- 雇主 CPF
- SDL
- SHG（适用时）
- 总收入、总扣款和净工资

所有 CPF 和法定规则必须使用带生效日期的配置表，不能把费率直接写死在页面或计算函数中。每次 Payroll 保存当时使用的规则版本，确保未来法规变化后仍能解释历史工资。

## 7.6 MOM Itemised Payslip

系统生成的 PDF 工资单至少包含：

- 公司和员工姓名
- 发薪日期
- 工资周期开始和结束日期
- 基本工资或工资率
- 津贴、奖金和其他收入
- 佣金
- 各项扣款
- 加班时数、工资和对应周期（适用时）
- 员工 CPF
- 净工资
- Payroll 编号

工资单可以由员工登录查看，也可以通过 Email 发送。系统需要保存工资单快照和发送记录，不能在工资规则变化后重新生成不同金额的历史工资单。

MOM 要求应以官方最新说明为准：<https://www.mom.gov.sg/employment-practices/salary/itemised-payslips>

## 7.7 Payroll 报表

至少提供：

- 每月 Payroll Summary
- 每位员工收入和扣款明细
- Commission Report
- CPF、SDL、SHG 汇总
- 按门店的工资和佣金成本
- Payroll 调整和作废报告
- CSV 导出

第 4 模块 Dashboard 中的员工业绩和佣金图表应直接使用同一套已确认数据。

## 7.8 权限和数据安全

- Owner：管理员工薪资、计算、审批、作废和查看全部报表。
- Employee：只查看自己的资料和工资单。
- Manager：默认不能查看工资；如未来需要，单独增加受控的 `payroll_admin` 权限。
- Frontdesk、Instructor：不能查看其他员工工资。
- Payroll 数据必须有严格 RLS，所有新增、修改、审批、查看工资单和导出行为必须记录。
- NRIC、银行账号等第一版非必要敏感信息不要收集；如未来需要，必须加密并限制读取。

## 7.9 建议新增的数据表

- `employees`：统一员工和雇佣资料
- `employee_compensation_profiles`：基本工资和薪资设置
- `employee_service_commission_rules`：员工/服务佣金规则
- `service_commission_entries`：每笔可追溯佣金
- `statutory_payroll_rules`：带生效日期的 CPF、SDL、SHG 规则版本
- `payroll_runs`：每月 Payroll 主记录
- `payroll_run_employees`：每位员工工资汇总和快照
- `payroll_line_items`：收入、津贴、佣金和扣款明细
- `payslips`：PDF、版本和发送记录
- `payroll_audits`：强制写入的 Payroll 专用审计记录

同时为未来的 `salon_appointments` 和现有 `service_orders` 增加 `employee_id`、`location_id` 和服务完成信息。

## 7.10 第一版明确不做

- IRAS AIS API 和自动 IR8A 提交
- 银行 GIRO 自动发薪
- Leave 和 Attendance
- 复杂排班工资
- 外籍员工税务申报
- 多国家 Payroll

Q18 是 Preferred，第一版可以回答 No。未来需要 AIS 时，再按照 IRAS AIS API 2.0 的正式接入流程开发：<https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-%28ais%29-for-employment-income/technical-format-specifications>

## 7.11 Payroll 验收和过审演示

提交前至少完成以下测试：

- 不同年龄和居民身份的 CPF 案例
- PR 第一、第二和第三年案例
- 不同工资区间和不足月工资案例
- 有佣金、奖金、津贴、加班和扣款的工资案例
- 服务退款后的佣金冲回案例
- Approved 后禁止直接修改的测试
- 员工只能查看本人工资单的权限测试
- Owner 审批、作废和重新生成的完整审计测试

正式技术演示使用一名员工完成服务并收款，系统自动产生佣金，Owner 建立并审批 Payroll，生成 MOM itemised payslip，员工登录查看工资单，最后展示 Payroll、Commission 和审计报告。

已取得回复确认 Q17 可以使用自建 Payroll，Q18 IRAS AIS 回答 No 不影响 Q17。因此本模块按 in-house Payroll 开发并申报；但 CPF、SDL、SHG、不足月工资、加班和 Payslip 等规则仍必须由熟悉新加坡 Payroll 的专业人士验证后才能正式上线。CPF 最新规则以官方资料为准：<https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay>

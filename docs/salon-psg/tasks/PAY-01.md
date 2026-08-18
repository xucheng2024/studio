# PAY-01：新加坡基础 Payroll 档案与法定规则

状态：已实现/待验证

## 目标和范围

以最小可演示范围满足 IMDA Salon Q17：员工档案、员工自助更新、E-payroll、Commission Report、Payroll Report、MOM Itemised Payslip，以及 CPF/SDL/SHG 法定合规。第一版是单币种 SGD、按自然月发薪，只支持月薪和时薪员工；不建设完整 HRIS。

开发及申报不以会计或薪资顾问签字为前置条件。规则以实施时有效的 MOM、CPF Board 官方资料为准；无法从官方资料确定的情况必须阻止 Finalise，不能猜测。

## 必须复用的现有实现

- 复用 `employees` 和 `employee_locations` 作为员工身份、账号、Instructor 和门店关系；不得新建第二套 Employee 主表。
- `staff_memberships` 只负责系统角色和访问权限，不存工资资料；现有 Staff 页面也不作为 Payroll 主档页。
- 复用 `employee_service_commission_rules` 和 append-only `service_commission_entries`。Payroll 只汇总、锁定和展示佣金 Entry，不重做佣金规则、成交归因或退款冲回。
- 复用 `strong_audit_logs` 的强审计能力，不再建立功能重复的普通审计框架。
- 复用现有 PDF/Email/四格式导出工具；只有缺失能力才扩展公共工具。

## 第一版数据和页面

新增一份与 `employees.id` 一对一的受限 Payroll Profile，Owner 可维护：

- 职位、出生日期；姓名、员工编号、Email、电话、入职/离职日期继续取自 `employees`；
- 居民身份：新加坡公民、PR、外籍；PR 保存取得 PR 的准确日期；
- 薪资类型：月薪或时薪，基本工资/时薪，每周正常工时；
- CPF graduated/full-rate 选择（只在规则允许时）、SHG 判定资料及有效的 opt-out/自定义金额证明；
- Profile 生效日和结束日，历史版本不可覆盖。

Employee 自助功能只开放本人 Email、电话更新和已发布 Payslip 查看。工资、身份、出生日期、PR 日期和 SHG 资料只允许 Owner 修改。Payroll 管理入口与 Staff Access 页面分开；普通 Manager、Frontdesk、Instructor 不获得工资权限。

## 官方规则版本

每个规则版本保存 `authority`、`source_url`、`source_effective_from`、`effective_from`、`effective_to`、`verified_at` 和不可变规则内容。未来费率只新增版本，不覆盖历史版本。

- CPF 资格、费率和年龄/PR 档位：<https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay>
- CPF 工资项目和 OW/AW：<https://www.cpf.gov.sg/employer/employer-obligations/what-payments-attract-cpf-contributions>
- SDL：<https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy>
- SHG：<https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups>
- 不足月工资：<https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary>
- 加班：<https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days>
- 合法扣款：<https://www.mom.gov.sg/employment-practices/salary/salary-deductions>
- Itemised Payslip：<https://www.mom.gov.sg/employment-practices/employment-records>

规则实现必须覆盖：公民、PR 第 1/2/3 年、外籍员工；员工及雇主 CPF；OW/AW 和当年 ceiling；SDL；适用时的 CDAC、ECF、MBMF、SINDA；官方取整规则。Payroll Run 保存实际使用的规则版本和计算快照。

## 第一版工资项目

预置且不可任意改公式的工资项目：

- 基本工资或正常时薪；
- 不足月工资；
- 服务佣金（来自 `service_commission_entries`）；
- 津贴、奖金；
- 加班时数和加班工资；
- 无薪缺勤和其他合法扣款；
- Employee CPF、Employer CPF、SDL、SHG；
- Gross Pay、Total Deductions、Net Pay。

每种工资项目明确是否进入 CPF、OW/AW、SDL、SHG 和 Payslip。第一版不提供自定义公式编辑器。时薪、加班时数、无薪缺勤等没有 Attendance 来源的输入由 Owner 手工录入并填写备注；系统负责按规则计算和留痕，不声称包含 Attendance/Roster。

不足月和法定加班按 MOM 公式实现。若员工不受 Employment Act Part 4 法定加班规则覆盖，第一版只允许录入已确定的合同加班金额并标注为合同项目，不替用户推断合同规则。

## PAY-01 验收

- 既有 Employee、Location 和 Commission 数据可直接被 Payroll Profile 引用，没有重复主档或重复佣金 Entry。
- Employee 只能更新本人 Email/电话；Owner 才能维护受限 Payroll Profile；其他角色不能读取工资资料。
- CPF 覆盖公民、PR 第 1/2/3 年、外籍、年龄跨档、低工资档、OW/AW ceiling 和取整边界。
- SDL 覆盖最低、普通、最高、外籍和公司月度合计；SHG 覆盖四个基金、身份边界及带证明的 override。
- 覆盖月薪/时薪、不足月、佣金、津贴、奖金、加班、无薪缺勤和合法扣款。
- 结果与实施当日 CPF Board 官方计算器或官方示例一致，并保存测试日期与规则版本。
- 缺少居民身份、PR 日期、SHG 判定资料或工资项目分类时阻止 Finalise，并显示具体缺失项。

## 明确不做

- Reviewed/Approved 两级审批和 Maker-Checker；第一版由 Owner Finalise；
- IRAS AIS、IR8A/IR21、银行 GIRO；
- Leave、Attendance、Roster、排班自动计薪；
- 日薪、计件工资、外籍员工个人所得税和多国家 Payroll；
- 任意 Payroll 公式编辑器、NRIC 或银行账号收集；
- 强制顾问签字。外部专业复核仅作为额外风险控制。

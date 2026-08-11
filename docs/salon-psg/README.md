# Salon PSG 最简过审改造方案

## 一、目标

在现有系统基础上定义一套 **Salon PSG Core Edition** 申请和报价范围。

现有功能不需要删除，也不要求全部从产品界面隐藏。需要明确区分：哪些模块属于本次 PSG 获批套餐，哪些是非资助附加模块。只有本次申报为 **Yes**、写入报价和合同的功能，才作为正式过审范围。

目标不是一次做完所有功能，而是用最少、可演示、可实际交付的改造满足申请要求。

## 二、现有功能可以直接复用

- 登录和员工权限
- 多门店基础功能
- 服务管理
- 客户名单
- HitPay 和现金收款
- 发票和退款
- Email 服务
- 操作记录
- Supabase 实时数据

## 三、模块文档

开始开发前先阅读 [统一开发约定](./00-development-guide.md)。每个模块文件包含：现有代码可复用部分、当前缺口、业务需求、建议数据结构、权限、接口和过审验收流程。

1. [美容预约](./01-appointment.md)
2. [多门店管理](./02-multi-location.md)
3. [客户档案](./03-customer-profile.md)
4. [经营仪表盘](./04-dashboard.md)
5. [前台收银 POS](./05-pos.md)
6. [营销 Campaign](./06-marketing.md)
7. [员工、佣金和薪资](./07-employees-commission-payroll.md)
8. [套餐管理](./08-packages.md)

申请范围、开发顺序、演示流程、预计工作量和最终完成标准统一放在 [申请范围与开发路线](./09-application-scope-roadmap.md)。实际编码任务及依赖关系见 [开发任务清单](./10-development-backlog.md)。

实际执行统一使用 [完整实施主计划](./16-complete-implementation-plan.md) 和 [实施状态表](./15-implementation-status.md)。开始每个任务前，从 [单任务模板](./tasks/TASK-TEMPLATE.md) 建立独立任务文件；已完成的基础任务也保留交付记录。

申请问题的当前状态、目标答案、完成条件和外部证明见 [Q1–Q35 申请对照表](./11-q1-q35-application-matrix.md)。

用户于 2026-08-11 提供的完整需求原文已保存在 [Q1–Q35 Requirements Source](./12-submitted-requirements-source.txt)，避免 Codex 附件路径无法被 Claude、Cursor、CI 或其他电脑读取。正式提交前仍需与 Vendor Management Portal 当时显示的最新版本核对。

给合伙人、申请顾问或非技术人员查看时，使用 [全部要求、当前状态与解决方案简表](./13-stakeholder-status-summary.md)。

Q16、Q17 和 Q18 的最新回复、产品决定及证据保存要求见 [已确认申请口径](./14-confirmed-clarifications.md)。

## 四、当前关键决定

- 现有课程 Session 保留，但不用于 Salon Appointment 演示。
- PSG Core Edition 只完成完整 Email E-Marketing；已确认 Q16 的 SMS / E-Marketing 是 OR，SMS 和 WhatsApp 本次都不做。
- Payroll 第一版自行实现基础功能，IRAS AIS 本次回答 No。
- Loyalty、完整 Inventory、Mobile App 和 AI 本次不申报为 Yes。
- 已确认 Q16 可使用 Email E-Marketing，Q17 可使用自建 Payroll，Q18 回答 No 不影响 Q17；确认记录和截图应作为申请证据保存。

## 五、文档维护方式

- 产品或申请范围变化：先更新本 README 和 `09-application-scope-roadmap.md`。
- 单个模块需求变化：只更新对应模块文件。
- 实际开发时：一次领取 `10-development-backlog.md` 中一个任务编号，并使用对应模块的验收清单。
- 每次开发前建立或更新 `tasks/TASK-ID.md`；完成后写入实际文件、Migration、验证结果、Commit/上线状态和风险。
- `15-implementation-status.md` 是唯一进度来源；模块文档和 Backlog 不重复维护“已完成”状态。
- 所有申请表中回答 Yes 的功能，必须同时出现在报价、合同、正式产品和技术演示中。

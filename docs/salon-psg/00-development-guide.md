# Salon PSG 统一开发约定

本文件是 Codex、Claude、Cursor 及人工开发者的共同入口。模块文档说明“做什么”，本文件规定跨模块“怎么保持一致”。任何实现与本文件冲突时，先更新文档并确认决定，再写代码。

## 0. 文档优先级和阅读顺序

出现冲突时按以下顺序处理：

1. 用户最新明确决定，以及提交时 Vendor Management Portal 的实际问题。
2. `12-submitted-requirements-source.txt` 中保存的完整要求原文。
3. `11-q1-q35-application-matrix.md` 的申报答案、状态和完成条件。
4. 本统一开发约定。
5. 对应模块需求文件。
6. `10-development-backlog.md` 的任务范围和依赖。

发现下层文档与上层要求冲突时，不自行选择一个实现；先修正文档或向用户提出具体冲突。附件路径不作为长期需求来源，所有开发者只依赖仓库内文件。

## 1. 开工方式

1. 从 [开发任务清单](./10-development-backlog.md) 领取一个任务编号，不一次实现整个模块。
2. 阅读对应模块文件、任务依赖和当前仓库相关代码。
3. 检查工作区已有改动，只修改任务直接相关文件。
4. 数据库变更先写 migration、约束、索引和 RLS，再实现服务端流程和页面。
5. 使用最小相关测试验证，完成后更新任务状态或交付说明。

每个任务还必须使用 `tasks/TASK-TEMPLATE.md` 建立独立实施记录。任务文件固定范围、非目标、迁移、权限矩阵和验收证据；`15-implementation-status.md` 只记录总体状态、Commit/上线位置和阻塞项，避免多个文件各写一套进度。

需求中的“必须”是验收条件，“建议”允许在不破坏目标的情况下采用等效实现，“未来/可选/第一版不做”不得擅自加入当前范围。

## 2. 当前技术架构约定

- 当前项目使用 Next.js 16 App Router、React 19、Supabase、Resend 和 HitPay。
- HitPay 与 Resend 均为 Studio BYOK：每个 Studio 配置并使用自己的 merchant/API 密钥。平台环境变量不得作为未配置 Studio 的静默回退去发送该租户的付款或邮件。
- Next.js 16 与旧版本存在差异；修改路由、缓存、Server Action 或 Route Handler 前先阅读仓库 `node_modules/next/dist/docs/` 中对应文档。
- 页面默认使用 Server Component；只有交互状态需要 Client Component。
- 后台已登录页面的普通修改优先沿用现有 Server Action 模式。
- Webhook、Cron、付款回调、公开退订和确需客户端异步调用的功能使用 Route Handler。
- 跨多表、余额、库存、预约资源、付款、退款、佣金和 Payroll 的关键写入必须在数据库事务/RPC 中完成。
- 外部服务调用不能假装与数据库处于同一事务；使用 Pending 状态、幂等键、Webhook 和可重试同步实现最终一致。
- 不新增依赖，除非现有组件和轻量自研实现明显无法安全满足需求。

## 3. 统一业务身份

- `studios`：一个独立 Salon 公司/租户，是数据隔离边界。
- `locations`：同一 Studio 的实体门店；实际预约、服务、销售和佣金必须归属一个 Location。
- `users` / `user_profiles`：登录身份和跨产品通用资料，不存 Studio 专属健康或工资资料。
- `salon_customers`：Studio 内客户主档，可选关联 `user_id`；Walk-in 也使用该身份或明确的匿名销售快照。
- `employees`：Studio 内员工/雇佣主档，可选关联登录 `user_id` 和现有 Instructor。
- `staff_memberships`：后台访问权限，不代表员工实际工作门店。
- `employee_locations`：员工真实可工作门店，多对多，并有一个 Primary Location。

任何新业务表都必须明确 `studio_id`。Location 业务表必须同时保存 `location_id`，并在数据库验证 Location 属于同一 Studio。

## 4. 模块间唯一数据关系

- Appointment 保存 Customer、Location、Service、实际 Employee 及资源占用。
- Completed Appointment 生成/关联 Treatment Record 和可收款服务来源，但不直接生成 Earned Commission。
- POS Sale 是多项目销售主单；`pos_sale_items` 是价格、折扣、员工和 Appointment 归属的财务明细。
- `payments` 是付款状态的唯一来源；仅服务端确认 Paid 后才能开正式收据、扣商品库存和生成佣金。
- Service Commission 只由“存在服务完成证据 + 对应 POS 服务明细已 Paid”触发。预约服务使用 Completed Appointment；无预约 Walk-in 使用 POS/Service Order 中由有权限员工确认的 `fulfilled_at`，不能伪造 Appointment。每个 POS Service Item 最多一条原始佣金记录，退款使用反向 Entry，不能覆盖原记录。
- “先付款后服务”和“先服务后付款”都必须支持；付款确认和服务完成两个入口都调用同一个幂等佣金资格检查，第二个条件满足时才生成 Entry。
- Treatment Record 描述实际服务过程，不作为收款或佣金金额来源。
- Package Balance 的每次变化必须有 Ledger Entry；`credits_left` 只是与 Ledger 同事务更新的当前余额。
- Dashboard 只读取统一业务事实，不重新定义付款、退款、客户或佣金状态。
- Marketing 只使用 Customer 和对应渠道有效 Consent，绝不读取健康、过敏、工资或疗程内部备注。

## 5. 统一状态与占用规则

- Appointment：`pending`、`confirmed`、`checked_in`、`in_progress`、`completed`、`cancelled`、`no_show`。
- `pending`、`confirmed`、`checked_in`、`in_progress` 占用员工和资源；其他状态不占用未来时段。
- 等待付款的 Pending Appointment 必须有 `expires_at` 并由幂等任务释放。
- POS Sale：`draft`、`pending_payment`、`paid`、`partially_refunded`、`refunded`、`voided`。
- Payment 状态沿用现有标准值，不为新模块创建同义状态。
- Payroll：`draft`、`reviewed`、`approved`、`paid`、`voided`。
- Campaign：`draft`、`scheduled`、`sending`、`completed`、`cancelled`、`failed`。

状态值在数据库使用小写 snake_case；界面可以显示易懂标签。所有状态转换必须有允许列表、操作者、时间和不可修改的历史记录。

## 6. 金额、时间和快照

- 金额使用数据库 `numeric` 和明确 Currency，不使用 JavaScript 浮点数作为最终财务计算依据。
- 所有金额、折扣、税额、退款和佣金在服务器/数据库重新计算，不信任浏览器总额。
- 数据库存 `timestamptz` UTC；页面、预约日历和业务日期按 `Asia/Singapore` 转换。
- Receipt、Payment、POS Item、Appointment、Commission 和 Payslip 保存当时名称、价格、员工、门店和规则版本快照。
- 已完成财务和 Payroll 记录不因主档改名、改价或规则更新而改变。

## 7. 权限、安全和隐私

- 所有读取和写入都同时检查 Studio Scope、Location Scope 和角色，不只隐藏按钮。
- Supabase Service Role 只在服务器使用，绝不发送到浏览器。
- Provider Secret 放环境变量或受控 Secret Store，不保存明文到普通业务表。
- 健康资料和 Payroll 使用比普通客户资料更严格的权限与查看审计。
- 普通报表、Marketing 和 CSV 禁止包含健康、过敏、疗程内部备注或工资明细。
- 关键 Audit 与业务写入同事务；best-effort 日志不能作为付款、余额、佣金或 Payroll 的唯一审计。
- Webhook 必须验证签名并幂等处理；重放请求不能产生第二笔付款、退款、库存、积分、收据或佣金。

## 8. Migration 和上线顺序

- Migration 文件使用仓库下一个可用序号，不修改已经应用的历史 migration。
- 新增必填列时先允许空值、回填和生成异常报告，再加约束；不能让未知历史数据随意归属某门店或员工。
- 所有新表同时建立外键、Check Constraint、必要索引和 RLS Policy。
- 唯一业务动作建立数据库唯一约束，例如 Provider Event ID、POS Item Commission Source 和 Package Ledger Source。
- 先上线兼容旧数据的读写，再迁移数据，最后移除旧路径；每一步都应可以安全重试。
- Schema、生成类型和应用代码必须在同一个任务中保持一致。

## 9. 每个任务的完成标准

一个任务只有同时满足以下项目才算完成：

- 需求和非目标没有被擅自扩大。
- Migration 可在空数据库和现有数据副本上成功执行。
- RLS/服务端权限包含允许和拒绝测试。
- 核心事务包含成功、失败、并发和重复请求测试。
- 页面支持桌面及手机，表单有 Loading、Error 和 Empty 状态。
- 金额、日期、门店和状态口径符合本文件。
- 相关 lint、typecheck、最小测试或构建通过；已有无关失败单独说明。
- 没有把 Secret、客户健康资料或 Payroll 数据输出到日志。
- 交付说明列出变更文件、验证结果、数据迁移影响和仍未解决风险。
- 对应 `tasks/TASK-ID.md` 已写入实际结果，`15-implementation-status.md` 已更新为正确状态；没有验证证据时只能标记“已实现/待验证”，不能标记“已验收”。

## 10. 编码代理任务提示模板

将下面内容与一个任务编号一起交给编码代理：

> 实现 `TASK-ID`。先阅读 `docs/salon-psg/00-development-guide.md`、`docs/salon-psg/10-development-backlog.md` 中该任务，以及对应模块文档。检查现有代码并复用项目模式，只完成该任务范围。数据库操作必须包含 RLS、约束、索引、迁移和最小测试；完成后报告修改文件、验证结果和未解决风险，不开始下一个任务。

## 11. 开发前仍需人工确认

- 已确认 Q16 是 OR，本次只实现完整 Email E-Marketing；不得实现 SMS/WhatsApp Campaign。
- 已确认 Q17 可以使用自建 Payroll，Q18 回答 No 不影响；法定计算按 `tasks/PAY-01.md` 的新加坡官方规则基线、版本记录和官方示例验证。
- Payroll 不以专业人士签字作为开发 Gate；无法从 MOM、CPF Board、SSG/相关官方机构资料确定的规则不得猜测，必须阻止计算并升级确认。
- PWA 是否会被申请方视为 Mobile App；未确认时 Q24 为 No。
- 非资助附加模块能否在同一产品中保留，以及报价/合同如何分开。
- Q29 的 PDPA Form 由公司 DPO/负责人完成，编码代理只能提供系统证据。
- Q30 必须由合资格独立第三方完成 VA/PT，内部扫描不能代替正式报告。
- 申请主体是 Product Principal 还是 Reseller，以及对应 Q31–Q35 认证路径。

这些问题不会阻止基础身份、门店、客户、预约和 POS 开发，但会阻止对应功能被标记为“可正式申报完成”。

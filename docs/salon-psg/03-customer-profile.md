# 3. 完整客户档案

客户档案必须按 Salon 公司隔离，并与 Appointment、Service Order、Payment、Package 和 Marketing 连接。健康和过敏资料不能直接继续写入现有 `user_profiles.notes`。

## 3.1 结合现有系统的改造原则

现有代码可以复用：

- `/dashboard/clients`：继续作为客户搜索和列表入口。
- `/dashboard/clients/[clientId]`：继续作为客户详情入口，目前已有联系方式、会员、套餐、付款和课程记录。
- `users` 和 `user_profiles`：继续保存登录账号及跨产品通用的姓名、Email 和电话。
- `member_studio_memberships`：继续证明客户属于哪一个 Studio。
- `payments`、`client_packages`、`customer_subscriptions` 和 `bookings`：继续作为现有消费与使用记录来源。
- `service_orders` 和新的 `salon_appointments`：作为 Salon 服务与疗程历史来源。
- 现有 Guest Merge 和 `resolveClientId` 逻辑：继续用于访客注册后关联历史付款和订单，但需要扩展到 Salon Customer、Appointment 和 Treatment。
- 现有 Studio/Location Scope：继续限制门店员工访问客户资料。

当前需要解决的代码缺口：

- 客户列表目前只显示已经注册并加入 Studio 的用户，Walk-in/Guest 客户无法成为完整客户档案。
- `user_profiles` 是用户全局资料，不按 Studio 隔离；如果直接存放健康信息，其他 Studio 可能错误共享同一份资料。
- 现有 `notes` 只有一个自由文本字段，无法分别管理偏好、过敏、健康状况、禁忌和跟进日期。
- 客户详情目前重点是 Package Ledger，没有完整展示 `service_orders`、Salon Appointment 和 Treatment History。
- 服务记录当前没有明确的服务员工和服务门店。
- 没有独立的 Marketing Consent、撤回记录和同意文本版本。
- 没有敏感客户资料的查看、修改和导出审计。

因此，应新增 Studio-scoped 的 Salon Customer 档案。`user_profiles` 只保留通用账号资料，Salon 偏好、健康资料和疗程记录存放在独立且严格受控的表中。

## 3.2 统一 Salon Customer 身份

每家 Studio 建立自己的 Customer 主档：

- 一个 Customer 只属于一个 Studio，但可以在该 Studio 的多家 Location 消费。
- Customer 可以关联一个已注册 `user_id`，也可以先作为未注册 Walk-in/Guest 存在。
- 同一位用户在两家不同 Studio 可以拥有完全独立的偏好、健康和疗程资料。
- 使用规范化 Email 和电话帮助识别可能重复客户，但不能仅凭姓名自动合并。
- 合并重复客户必须由 Owner 或 Manager 确认，并保存合并前后记录。
- Guest 后续注册账号时，应关联原 Customer ID，而不是建立第二份健康或疗程资料。

现有 `member_studio_memberships` 可以继续管理会员关系，但 Appointment、Treatment 和 Customer Profile 应统一关联新的 `salon_customers.id`，避免注册用户和访客使用两套历史。

## 3.3 基本客户资料

Owner、Manager 或 Frontdesk 可以在授权范围内维护：

- 姓名
- Email 和电话
- 出生日期（确有业务需要时）
- 常用门店
- 客户标签
- 紧急联系人（确有需要时）
- 内部服务备注
- 客户状态：Active、Inactive、Blocked
- 建档来源：Online、Frontdesk、Walk-in、Imported

不应为了方便而收集完整 NRIC 或其他与 Salon 服务无关的敏感身份资料。

## 3.4 客户偏好

客户偏好至少支持：

- 常用或喜欢的服务
- 首选服务员工
- 首选门店
- 首选预约时间
- 沟通语言
- Email、SMS 或电话联系偏好
- 产品或香味偏好
- 房间、环境或服务习惯备注

偏好用于员工服务准备和客户体验，不等同于 Marketing Consent。客户喜欢 SMS 联系，不代表客户已经同意接收 SMS 营销。

## 3.5 过敏、健康状况和禁忌

健康资料使用结构化字段，并保留必要的补充说明：

- 已知过敏项目
- 可能引发反应的产品或成分
- 客户主动申报的健康状况
- 怀孕或其他影响服务选择的状态（仅在服务确有需要时收集）
- 不适合进行的服务或禁忌
- 是否需要 Patch Test
- Patch Test 日期和结果
- 资料最后确认日期
- 记录人和最后修改人

系统不负责进行医学诊断，只记录客户提供的信息和 Salon 为安全服务所需的限制。Appointment 选择服务时，如果客户存在相关禁忌，系统必须显示明显提醒，并要求有权限的员工确认后才能继续。

健康资料不能显示在普通客户列表、Marketing 导出或无关报表中。

## 3.6 历次服务和疗程记录

服务历史应主要由 Completed Appointment、Service Order 和 Payment 自动生成，不由员工重复手工建立一份无法核对的销售记录。

每次 Treatment Record 至少包含：

- Customer
- Appointment
- Service Order 和 Payment（如适用）
- 服务日期和完成时间
- 门店
- 服务员工
- 服务名称、价格和时长快照
- 使用的产品或设备
- 服务前观察
- 实际进行的疗程内容
- 客户反应
- 服务后建议
- 是否发生不良反应
- 内部疗程备注
- 建立人和建立时间

Treatment Record 建立后不能无痕覆盖。修改时保存修订版本、修改原因、修改人和时间。

## 3.7 服务员工

- 每次 Appointment 和 Treatment 必须记录实际服务员工。
- 如两名员工共同服务，可以有一名主要员工和多名协助员工。
- 实际服务员工用于客户历史、员工业绩和佣金计算。
- 临时更换员工时必须记录原员工、新员工、原因和时间。
- 客户档案可以根据历史自动计算最常服务员工，但不能覆盖客户手工选择的首选员工。

## 3.8 疗程备注和跟进日期

员工可以为每次 Treatment 设置：

- 内部疗程备注
- 建议下次服务
- 建议复诊/跟进日期
- 跟进负责人
- 跟进状态：Pending、Completed、Cancelled
- 跟进结果

到达跟进日期后，系统在后台显示 Follow-up Queue。只有客户有有效 Marketing Consent 时，才可以使用营销 Campaign 发送推广信息；与服务安全直接相关的必要通知需要单独说明用途，不能混用营销同意。

## 3.9 客户营销同意

Marketing Consent 必须按渠道分别记录：

- Email Marketing
- SMS 或其他未来渠道（本次不实现）；以后新增时必须单独取得同意，不能与 Email 同意共用

每次同意或撤回至少保存：

- Customer
- 渠道
- Granted 或 Withdrawn
- 同意来源：Online、Frontdesk、Imported
- 时间
- 操作者
- 客户看到的同意文本版本
- 证明或备注（如适用）

Marketing 模块发送前必须实时检查有效同意。客户撤回后不能继续进入新的营销名单，历史 Campaign 记录仍然保留。服务条款、隐私告知、Appointment 通知和 Marketing Consent 必须分开，不能使用一个总勾选框代替。

## 3.10 客户详情页面

将现有客户详情从 Package Ledger 扩展为完整 Customer Profile，并至少提供：

- **Overview**：基本资料、标签、偏好和重要提醒
- **Health & Safety**：过敏、健康状况、禁忌和 Patch Test
- **Appointments**：未来和历史 Appointment
- **Treatments**：历次疗程、员工、门店、备注和跟进
- **Purchases**：Payments、Service Orders、Packages 和 Memberships
- **Follow-ups**：待跟进和已完成记录
- **Consents**：隐私和各营销渠道同意历史
- **Audit**：敏感资料修改、查看和导出记录（仅授权角色）

客户列表可以显示姓名、联系方式、最近到店、常用门店和客户标签，但不能直接显示过敏或详细健康内容。需要安全提醒时只显示“有健康/过敏提醒”，进入详情后再按权限查看。

## 3.11 多门店访问规则

- Customer Profile、偏好和健康资料属于整个 Studio，可在该 Salon 旗下门店连续使用。
- Owner 和拥有全门店权限的 Manager 可以查看全部客户资料。
- Location Manager、Frontdesk 和 Employee 只有在客户与其授权门店存在 Appointment、Treatment、Payment 或其他业务关系时才能访问。
- Employee 默认只查看为完成当前或历史服务所必要的客户资料。
- 不同 Studio 之间绝对不能共享健康、偏好、疗程或 Consent 数据，即使客户使用同一个登录账号。

所有规则必须在数据库 RLS 或服务端 Scope 中实施，不能只依赖页面按钮。

## 3.12 隐私和数据保护

- 收集资料前显示用途并取得适用的客户同意。
- 只收集完成 Salon 服务所需要的资料。
- 客户可以申请查看和更正自己的资料。
- 为健康资料设置更严格的读取、修改和导出权限。
- 记录敏感资料的查看、修改、导出和合并行为。
- 设置资料保留政策；业务或法律目的结束后删除或去标识化。
- 禁止将过敏、健康和疗程备注包含在一般 CSV 或 Marketing 导出中。
- 删除客户时不能破坏必须保留的付款和审计记录，应使用去标识化或受控删除流程。

新加坡 PDPA 的同意、目的限制、准确性、保护、保留、访问和更正等要求以 PDPC 官方说明为准：<https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations>

## 3.13 建议新增的数据表

- `salon_customers`：Studio-scoped 客户主档，可选关联 `user_id`
- `salon_customer_preferences`：客户偏好
- `salon_customer_health_profiles`：过敏、健康状况、禁忌和资料确认日期
- `salon_treatment_records`：每次服务和疗程记录
- `salon_treatment_record_revisions`：疗程记录修改历史
- `salon_customer_follow_ups`：跟进日期、负责人和结果
- `salon_customer_consents`：隐私及各营销渠道同意历史
- `salon_customer_merge_audits`：客户合并记录
- `salon_customer_access_audits`：敏感资料查看、修改和导出记录

`salon_customers` 建议以 `(studio_id, id)` 作为业务隔离基础，并为 `(studio_id, user_id)` 建立条件唯一约束。Email 和电话只作为重复提示，不直接作为自动合并唯一键。

## 3.14 现有数据迁移

- 为现有 `member_studio_memberships` 客户建立对应 Salon Customer。
- 将现有姓名、Email 和电话关联到 Customer，但不复制到健康资料。
- 现有 `user_profiles.notes` 保留为 Legacy Operational Note，不能自动判断为过敏或病史。
- 由门店员工人工把仍然有效的 Legacy Note 分类到偏好、健康或一般备注。
- 将现有 Payment、Package、Membership、Booking 和 Service Order 逐步关联到 Salon Customer。
- 扩展 Guest Merge，使 Walk-in 客户注册后保留 Appointment、Treatment、Payment 和 Consent 历史。

迁移过程必须生成匹配、跳过、冲突和人工处理报告，不能仅靠 Email 自动合并所有客户。

## 3.15 测试和过审验收

提交前至少验证：

- 同一登录用户在两家 Studio 的健康档案完全隔离。
- Walk-in 客户注册后可以正确关联原有服务和付款历史。
- 客户详情完整显示服务日期、门店、员工和疗程备注。
- Appointment 选择存在禁忌的服务时显示安全提醒。
- Location-scoped 员工不能访问与本门店无业务关系的客户。
- Frontdesk、Employee 和 Customer 不能看到无权访问的敏感字段。
- 疗程记录修改会留下原内容、原因和修改人。
- 客户撤回 Email Marketing Consent 后立即从 Email 营销名单排除。
- 一般客户导出和 Marketing 导出不包含健康资料。
- 客户资料查看、更改、导出和合并都有审计记录。

正式技术演示流程：建立 Walk-in 客户 → 填写偏好、过敏、健康禁忌和营销同意 → 建立 Appointment 并展示安全提醒 → 员工完成服务并填写疗程记录和跟进日期 → 在客户档案查看历次服务、门店和员工 → 撤回营销同意并证明客户不再进入 Campaign → 展示敏感资料访问和修改审计。

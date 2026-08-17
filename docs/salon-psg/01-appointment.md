# 1. 美容预约系统

新增独立的 Salon Appointment 模块。现有课程 `classes`、`class_sessions` 和 `bookings` 继续服务团体课程，不改名、不混用，也不作为 Salon 申请演示。

## 1.1 结合现有系统的改造原则

现有代码可以复用：

- `locations`：作为预约门店。
- `studio_services`：作为 Salon 服务项目和价格来源。
- `users`、`user_profiles`：作为已注册客户资料来源，并继续支持 Walk-in 客户。
- `staff_memberships` 和未来统一的 `employees`：用于员工身份、门店范围和操作权限。
- `payments`、HitPay、Invoice 和退款流程：用于预约订金、全额付款和到店收款。
- `booking_rules`：复用取消期限、爽约等规则的设计思路，但 Salon Appointment 使用自己的规则配置。
- 现有 Email、Web Push 和 Cron 基础：用于预约确认、提醒和变更通知。
- `operation_audits`：继续记录普通预约操作；关键状态变化使用数据库事务确保预约和审计同时成功。

当前代码的主要缺口：

- `class_sessions` 是固定时间和容量的团体课程，不适合一对一 Salon 服务。
- `studio_services` 当前缺少标准服务时长、服务缓冲时间、可服务员工和可用门店。
- `instructors` 与员工登录身份尚未统一，无法作为稳定的 Appointment 员工来源。
- 没有员工上班时间、休息、请假和临时不可预约时间。
- 没有房间、床位和设备资源。
- 现有预约创建依赖名额数量，不能检查员工或资源的时间冲突。
- 现有客户不能自行取消课程预约；Salon Appointment 需要按权限支持客户和员工操作。
- `sendClassReminder` 已存在，但没有完整的自动提醒任务、重试和发送记录。
- 当前 Cal.com 只是外部链接，不作为 Salon Appointment 的核心数据来源或过审证明。

因此，应新建 Appointment 数据模型和页面，只复用已有基础设施，不能直接扩展或改造 `class_sessions` 来假装 Salon Appointment。

## 1.2 服务预约设置

在现有 Services 页面为每项服务增加：

- 标准服务时长
- 服务前准备时间
- 服务后清理/缓冲时间
- 可提供服务的门店
- 可提供服务的员工
- 所需房间、床位或设备类型
- 是否允许在线预约
- 是否需要员工确认
- 是否允许订金或全额在线付款
- 取消和改期规则

服务名称、价格、时长和规则必须在预约建立时保存快照，避免之后修改服务资料导致历史预约变化。

## 1.3 员工上班时间

Owner 或 Manager 可以设置：

- 员工每周固定工作日和上下班时间
- 每天一个或多个休息时间
- 所属门店
- 临时加班时段
- 请假、培训、会议和其他不可预约时间
- 某员工可以提供哪些服务

预约只能落在员工的有效工作时段内。员工在其他门店已有预约、休息或不可用时，不能再次预约。

## 1.4 房间、床位和设备

每个门店可以建立预约资源：

- 房间
- 美容床或按摩床
- 仪器和设备
- 其他需要独占使用的资源

每个资源至少包含名称、类型、所属门店、启用状态和可容纳数量。第一版建议把每张床和每台关键设备建立为独立资源，减少复杂的数量分配错误。

服务可以设置必需资源。建立预约时，系统自动推荐可用资源，也允许有权限的员工更换资源。

## 1.5 创建和编辑 Appointment

新增 `/dashboard/appointments` 页面，提供日视图和周视图，并支持按门店、员工和状态筛选。

Owner、Manager 和 Frontdesk 可以：

1. 搜索或新增客户。
2. 选择服务。
3. 选择门店。
4. 选择员工。
5. 选择开始时间。
6. 系统根据服务时长自动计算结束时间和缓冲时间。
7. 自动分配或选择房间、床位和设备。
8. 查看价格并选择未付款、订金或全额付款。
9. 填写客户备注和仅员工可见的内部备注。
10. 确认预约并发送通知。

修改员工、时间、门店或资源时必须重新运行全部可用性检查，并记录修改前后的内容。

客户在线建立预约或购买时必须展示当前 Terms & Conditions，并要求主动勾选接受。系统保存 Terms 版本、内容摘要、接受时间、客户/Guest、预约或付款来源和渠道；后续修改 Terms 不能覆盖历史接受证据。后台员工代客建立预约时，也要记录由谁确认客户已接受或使用的线下确认方式。

公开页面可以在登录前展示服务介绍，但客户自助查看实时档期、提交预约、查看本人预约、取消或改期必须通过 Supabase 安全登录并验证 Studio Customer 身份。Guest/Walk-in 预约只能由有权限的 Frontdesk 建立，不作为 Q5–Q6 客户自助演示。

客户确认预约时，系统按以下任一有效方式完成资格/付款检查：使用适用于该服务及门店且余额充足的 Package Credits、符合已配置规则的 Free Trial/First-time Customer 权益、支付订金、或支付全额。Package 扣减和预约建立必须通过唯一来源键关联；任何失败都不能留下已扣余额但未建立预约的状态。

APT-04 分两段交付：在 APT-03、CRM-01 完成后可先实现安全登录、实时档期、本人预约、改期/取消和 Terms；最终上线 Gate 等待 PKG-01 与 POS-03，补齐 Package Credits、订金和全额付款。现有 Class Pass 只继续用于 Class Session，除非套餐已通过 PKG-01 明确配置 Salon Service/Location 适用关系，否则不得用于 Salon Appointment。

## 1.6 防止重复预约

冲突检查不能只在页面完成，必须在数据库事务或原子 RPC 中再次执行，避免两名前台员工同时抢到同一个时段。

建立或改期时同时检查：

- 员工是否在上班时间内
- 员工是否已有重叠预约
- 员工是否处于休息、请假或 blocked time
- 房间、床位和设备是否已有重叠预约
- 资源是否属于预约门店
- 员工是否可以提供所选服务
- 服务是否在所选门店开放

系统以“服务开始时间－准备时间”至“服务结束时间＋清理时间”作为完整占用时段。冲突时不得保存预约，并返回明确原因。

## 1.7 Appointment 状态流程

第一版至少支持：

1. **Pending**：等待员工确认或等待付款。
2. **Confirmed**：时间、员工和资源已经锁定。
3. **Checked-in**：客户已经到店。
4. **In progress**：服务正在进行。
5. **Completed**：服务完成，可进入 POS 收款、疗程记录和佣金计算。
6. **Cancelled**：客户或员工取消，并记录取消人、原因和时间。
7. **No-show**：客户未到店，并记录爽约结果。

只允许合法状态转换。例如 Cancelled、Completed 和 No-show 不能直接恢复为 In progress；如需恢复，必须由 Owner 执行并留下审计记录。

Pending、Confirmed、Checked-in 和 In progress 都占用员工及资源时段；Completed、Cancelled 和 No-show 不再占用未来时段。等待付款的 Pending 必须保存 `expires_at`，到期任务在同一事务中取消预约并释放资源，避免永久占位。

Completed 后应自动：

- 允许建立或关联 Service Order 和 Payment
- 建立客户疗程历史
- 标记服务已经完成，但不直接生成佣金；佣金只在对应 POS 服务明细实际 Paid 后由统一佣金事务生成一次
- 更新 Appointment 和 Dashboard 报表数据

## 1.8 取消和改期

- 员工可以按照门店权限取消或改期。
- 客户自助取消或改期仅适用于已登录客户，并受到预约规则限制。
- 取消必须填写或选择原因。
- 涉及订金或全额付款时，复用现有退款流程处理退款或保留订金。
- 改期必须在同一个事务中释放原员工/资源时段并锁定新时段，失败时保留原预约。
- 所有操作保存操作者、原时间、新时间、原因和通知结果。

## 1.9 自动通知

至少提供：

- 预约确认通知
- 预约前提醒
- 改期通知
- 取消通知
- 员工或资源变更通知
- 可选的爽约后跟进通知

Owner 可以设置提醒提前时间，例如预约前 24 小时和 2 小时。第一版使用该 Studio 自己配置的 Resend 发送 Email；未配置时通知失败并显示 email provider not configured，不得回退平台 key。SMS 不属于本次 PSG Core Edition。

通知任务必须具备：

- Cron 定时扫描
- 唯一发送键，避免重复发送
- Pending、Sent、Failed 状态
- 失败原因和重试次数
- 发送时间、接收人和模板快照
- 已取消或已改期预约不发送旧提醒

发送通知失败不能删除预约，但必须在后台显示异常，让员工可以重发。

## 1.10 权限

- Owner：全部设置、预约操作和报表权限。
- Manager：管理授权门店的员工时间、资源和预约。
- Frontdesk：在授权门店建立、确认、改期、取消和 Check-in。
- Employee/Instructor：只查看自己的预约，可标记到店、开始和完成，不能修改薪资或其他员工安排。
- Customer：只查看和操作自己的预约，不能看到内部备注、员工排班或其他客户资料。

所有读取和写入都必须按 Studio 和 Location 执行 RLS/服务端权限检查，不能只依赖页面隐藏按钮。

## 1.11 建议新增的数据表

- `salon_appointments`：预约主记录、状态、时间和快照
- `salon_appointment_status_history`：不可修改的状态历史
- `employee_working_hours`：员工固定工作时间
- `employee_availability_exceptions`：请假、加班和 blocked time
- `salon_resources`：房间、床位和设备
- `salon_appointment_resources`：预约占用的资源
- `service_locations`：服务可用门店
- `service_employees`：服务可用员工，由 APT-01 建立；不再归入 FND-03
- `service_resource_requirements`：服务所需资源类型
- `salon_appointment_notifications`：通知任务、结果和模板快照
- `salon_appointment_rules`：确认、取消、改期、订金和提醒规则
- `salon_terms_versions`：可发布的 Terms & Conditions 版本和内容摘要
- `salon_terms_acceptances`：客户/Guest 对具体 Appointment 或 Purchase 的接受证据

`salon_appointments` 至少关联 Studio、Location、Service、Customer/Guest、Employee、Payment 和 Service Order，并保存服务标题、价格、时长和员工姓名快照。

## 1.12 第一版页面

- `/dashboard/appointments`：日/周预约日历
- `/dashboard/appointments/new`：建立预约
- `/dashboard/appointments/[id]`：详情、状态、改期、取消、付款和通知记录
- `/dashboard/settings/appointment-rules`：预约和提醒规则
- `/dashboard/settings/staff-availability`：员工工作时间和不可用时段
- `/dashboard/settings/resources`：房间、床位和设备
- `/[studioSlug]/appointments`：客户在线预约入口（如本次 Q5/Q6 申报 Yes）
- `/[studioSlug]/me/appointments`：客户查看、取消和改期

## 1.13 测试和过审验收

提交前至少验证：

- 同一员工同一时间不能出现两笔预约
- 同一房间、床位或设备不能重复占用
- 员工休息、请假和非上班时间不能预约
- 不同门店之间仍能发现同一员工的时间冲突
- 两个并发请求只能成功一个
- 改期失败时原预约和原资源仍然保留
- 取消和退款失败不会留下半完成状态
- 提醒不会重复发送，也不会发送给已取消预约
- Frontdesk 不能操作未授权门店
- 员工和客户只能查看自己有权查看的预约
- 在线预约或购买未接受当前 Terms 时不能提交，接受记录可以追溯到当时版本

正式技术演示流程：建立员工上班时间和门店资源 → 配置服务时长和所需设备 → 为客户建立预约 → 展示重复预约被拒绝 → 发送预约确认 → 改期并发送变更通知 → 客户到店并完成服务 → 进入 POS、疗程记录和佣金流程。

# 2. 多门店管理

多门店必须建立在现有层级上：一个 Salon 公司使用一个 `studio`，旗下每家实体门店使用一个 `location`。多个 `studio` 代表不同公司或不同客户，不应当用来代替同一公司的多个门店。

## 2.1 结合现有系统的改造原则

现有代码可以复用：

- `locations` 和 Locations 设置页面：已经支持门店名称、地址、电话和启用状态。
- `DashboardLocationFilter`：已经支持“All locations”或单个门店切换。
- `getDashboardScopeForRoles` 和 RBAC：已经区分全门店权限与指定门店权限。
- `staff_memberships.location_id = null`：继续表示该账号拥有全部门店访问权。
- `staff_memberships.location_id = 某门店`：继续表示该账号只能访问指定门店。
- `payments`、`bookings`、`events`、`packages` 等现有数据已有 `location_id`，可用于门店筛选和汇总。
- Reports 和 Payments 页面现有日期、门店及渠道筛选可以继续扩展。

当前需要解决的代码缺口：

- `studio_services` 目前是 Studio-level Catalog，没有服务与门店的对应关系。
- 服务不能选择“全部门店”或多个指定门店，也不能向选定门店批量发布更新。
- `service_orders` 当前没有 `location_id`，前台服务销售会记成未分配门店，导致报表不准确。
- `instructors` 和员工资料目前只保存一个 `location_id`，不适合员工跨两家或多家门店工作。
- Staff 页面展示的是系统访问权限，不等于员工真实所属门店和排班门店。
- 部分模块支持门店筛选，Shop、Service Catalog、Member Zone 等仍是 Studio-level，需要明确哪些数据属于总部、哪些属于门店。
- All locations 报表依赖每笔业务正确填写 `location_id`；当前部分服务销售和 Studio-level 数据无法准确归店。

因此，多门店改造重点不是重写现有 Location，而是补齐服务发布、员工多门店归属、业务数据强制归店，以及可靠的合并报表。

## 2.2 门店资料

Owner 可以建立和管理多家门店，每家门店至少包含：

- 门店名称
- 地址和联系电话
- 营业时间
- 启用或停用状态
- 收据/发票显示名称（如需要）
- 预约提醒使用的门店联系资料
- 可提供的服务
- 可工作的员工
- 可用房间、床位和设备

门店停用后：

- 不允许建立新 Appointment 或新销售。
- 已有历史预约、付款和报表仍然保留。
- 停用前必须提示未来预约数量，由 Owner 决定取消或转移。
- 不能通过删除门店来清除历史业务数据。

## 2.3 一个账号管理所有门店

- Owner 使用一个登录账号管理同一 Studio 下的所有 Location，无需为每家门店重新登录。
- 总部 Manager 可以被授予全部门店权限。
- 门店 Manager、Frontdesk 和 Employee 只访问授权门店。
- 用户切换门店时保留当前功能页面和必要筛选，不要求重新登录。
- All locations 选项只向拥有全门店权限的 Owner 或 Manager 显示。
- 指定门店账号登录后自动进入其授权门店，不能通过修改 URL 访问其他门店。

现有 `staff_memberships` 继续负责系统权限。员工实际在哪些门店工作，使用独立的 `employee_locations` 管理，避免把“可以登录该门店”和“被安排在该门店工作”混为一件事。

## 2.4 服务发布到全部或指定门店

现有 `studio_services` 继续保存总部统一的服务主档，例如服务名称、说明、图片和默认价格。

新增服务发布范围：

- **All locations**：当前及以后新增的所有门店默认提供该服务。
- **Selected locations**：只在勾选的一个或多个门店提供。
- 每家门店可以停用某项服务，而不删除总部服务主档。
- 如业务需要，可以设置门店价格、时长和缓冲时间覆盖值；未设置时使用总部默认值。

Owner 或总部 Manager 更新服务时，可以选择：

1. 更新全部门店。
2. 只更新指定门店。
3. 只更新总部默认值，不覆盖已有门店自定义值。

执行更新前应显示受影响门店，更新后记录服务、门店、修改前后内容、操作者和时间。公开预约页面只能显示该门店已启用的服务。

## 2.5 员工属于指定门店

员工可以属于一家或多家门店，并设置一个主要门店：

- Owner 建立员工后选择可工作门店。
- 员工可在多家门店有不同工作时间。
- Appointment 只能选择在该门店有效、能够提供对应服务的员工。
- 员工跨店工作时，必须跨全部门店检查时间冲突。
- 员工停用某门店后，不再接受该门店新预约，但历史记录保留。

`staff_memberships` 继续决定后台访问权限；新增的 `employee_locations` 决定真实业务归属和排班。未来统一的 `employees` 应关联现有登录账号和 Instructor 身份。

## 2.6 所有业务数据必须归属门店

下列新业务记录必须填写有效 `location_id`：

- Salon Appointment
- Service Order
- POS Sale 和 Payment
- Treatment Record
- Commission Entry
- Payroll 的门店成本分配
- 房间、床位和设备占用

建立记录时，服务端必须验证 Location 属于当前 Studio，并验证操作者有该门店权限。不能只依赖页面隐藏选项。

总部配置、全公司客户主档和全门店服务主档可以保持 Studio-level；实际发生的预约、服务、收款和佣金必须归到具体门店。

## 2.7 单店和全部门店报表

Reports 页面必须支持：

- All locations 合并报表
- 单个门店报表
- 多门店对比报表

至少提供：

- 各门店预约数量、完成率、取消率和爽约率
- 各门店销售额、退款和净收入
- 各门店服务销售排行
- 各门店新客户和回头客
- 各门店员工业绩和佣金
- 全部门店合并总数

All locations 总数必须等于各门店数据之和，并单独显示历史未分配门店的数据，不能静默混入某家门店。只有 Owner 和拥有全部门店权限的 Manager 可以查看合并报表。

统一的日期、门店、员工和服务筛选必须作用于所有 Dashboard 图表。导出的 CSV 使用与页面相同的门店权限和筛选范围。

## 2.8 权限要求

- Owner：管理全部门店、服务发布范围、员工门店归属和合并报表。
- Global Manager：管理全部门店，但不能管理 Owner 或平台级设置。
- Location Manager：只管理授权门店的服务覆盖、员工、预约和报表。
- Frontdesk：只处理授权门店的预约、客户和收款。
- Employee/Instructor：只查看本人在授权门店的工作和 Appointment。

所有 Location-scoped 表必须有 RLS 或服务端 Scope 检查。任何 URL 参数、表单隐藏字段和 API Body 中的 `location_id` 都必须在服务端重新验证。

## 2.9 建议新增或调整的数据结构

- `location_operating_hours`：每家门店营业时间
- `service_locations`：服务发布门店、启用状态和门店覆盖值
- `employee_locations`：员工可工作门店和主要门店
- `location_change_audits`：服务发布和门店配置变更记录；也可扩展现有审计表
- 为 `service_orders` 增加必填的 `location_id`
- 为 `salon_appointments`、Treatment、Commission 和 POS 数据增加必填 `location_id`

`service_locations` 至少包含 Service、Location、是否启用、是否使用总部默认值、门店价格、门店时长和更新时间。All locations 发布模式可以保存在服务主档，同时为有覆盖值的门店建立记录。

## 2.10 第一版页面改造

- `/dashboard/settings/locations`：补充营业时间和停用检查。
- `/dashboard/services`：增加 All locations / Selected locations 和门店覆盖设置。
- `/dashboard/staff`：增加员工可工作门店与主要门店，不与登录权限混用。
- `/dashboard/appointments`：使用全局 Location Filter，并按权限显示 All locations。
- `/dashboard/reports`：增加单店、合并和多门店对比。
- POS、Payments、Customers、Marketing 和 Payroll：统一使用同一个门店筛选和权限规则。

## 2.11 测试和过审验收

提交前至少验证：

- Owner 一个账号可以切换并管理多家门店。
- 指定门店账号无法查看或修改其他门店数据。
- All locations 服务在新增门店后按规则自动可用。
- Selected locations 服务只在选定门店显示和预约。
- 总部更新可以推送全部门店或指定门店，并保留审计记录。
- 一名员工可以属于多家门店，并能跨店检测 Appointment 冲突。
- 每笔 Appointment、Service Order、Payment 和 Commission 都正确归店。
- 单店报表与合并报表数据可以相互核对。
- 未分配门店的历史数据单独显示，不影响新业务。
- 停用门店不能产生新业务，但历史数据仍可查询。

正式技术演示流程：Owner 登录一个账号 → 建立两家门店 → 建立一个全门店服务和一个指定门店服务 → 将员工分配到指定门店 → 分别建立预约和收款 → 切换单店查看数据 → 切换 All locations 查看合并及对比报表 → 使用门店账号证明不能访问另一家门店。

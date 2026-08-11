# 4. 经营数据仪表盘

只建立一套 Salon Operations Dashboard，用四个明确的图表和四个公共筛选满足申请要求。现有 Revenue Reports 保留作为财务明细页，但不能直接作为合规 Dashboard，因为目前主要是统计卡和表格，没有四个图表。

## 4.1 结合现有系统的改造原则

现有代码可以复用：

- `/dashboard/reports`：继续作为新 Dashboard 的入口。
- `DashboardLocationFilter`：继续提供 All locations 和单门店筛选。
- 现有日期范围、Order Type 和 Sales Channel 查询参数设计可以复用。
- `revenue-summary.ts`：继续复用 Gross、Refund、Net 和按日汇总逻辑。
- `payments` 的 `paid_at`、`verified_at`、`refunded_at`：继续作为收入和退款的财务时间依据。
- `payment-classification.ts`：继续区分 Service、Package、Membership、Shop 等收入来源。
- `canViewReports`、Studio/Location Scope：继续限制 Owner 和 Manager 的报表权限。
- `date.ts` 和 `sgt.ts`：继续用于新加坡时区日期边界和显示。

当前需要解决的代码缺口：

- Reports 页面目前只有统计卡和 Revenue by day 表格，没有符合要求的四个图表。
- 现有筛选只有日期、门店、订单类型和渠道，没有员工和具体服务筛选。
- `service_orders` 和 `payments` 当前缺少完整的服务员工、服务门店和 Appointment 关联，无法计算员工业绩。
- 现有 Client 报表没有“新客户、回头客和访问频率”的统一定义。
- 当前 Reports 查询最多读取 5,000 笔 Payment；数据增长后会被截断，合并报表可能错误。
- 当前收入报表主要在应用层载入明细再计算，不适合长期多门店和大数据量统计。
- 现有 Classes、Events、Shop 和 Salon Service 数据口径混在一起，Salon 过审 Dashboard 需要明确只统计申报范围内的数据。

因此，新 Dashboard 必须以 Salon Appointment、Service Order、Payment、Customer 和 Commission 的统一数据关系为基础，并在数据库中完成聚合，不能依赖页面读取固定数量明细后计算。

## 4.2 公共筛选

Dashboard 顶部统一提供四个筛选：

- **日期**：开始日期和结束日期
- **门店**：All locations 或一个门店
- **员工**：All employees 或一个员工
- **服务**：All services 或一个服务

所有图表必须使用同一次筛选条件和同一数据权限。点击 Apply 后，四个图表、顶部 KPI 和 CSV 导出同时更新，不能出现某个图表忽略员工或服务筛选。

筛选规则：

- 默认显示本月。
- 提供 Today、Last 7 days、This month、Last month 等快捷范围。
- 所有日期按 Asia/Singapore 日历日计算。
- 日期范围必须验证开始日期不晚于结束日期，并限制过大的查询范围。
- Location-scoped Manager 只能选择授权门店，不能看到 All locations。
- 员工列表只显示所选门店可工作的员工。
- 服务列表只显示所选门店启用的服务。
- 切换门店后，如果原员工或服务不属于新门店，应自动清除无效筛选。
- URL 保留 `date_from`、`date_to`、`location_id`、`employee_id` 和 `service_id`，便于刷新、分享和申请演示。

## 4.3 图表一：预约完成、取消和爽约

建议使用按日或按周的堆叠柱状图，显示：

- Completed
- Cancelled
- No-show

图表数据来自 `salon_appointments`，按 Appointment 的服务开始日期统计。Pending、Confirmed、Checked-in 和 In progress 可以显示在顶部 KPI，但不进入已经结束预约的完成率分母。

至少显示：

- 已完成预约数
- 已取消预约数
- 爽约数
- Appointment Fulfilment Rate
- Cancellation Rate
- No-show Rate

建议口径：

- Fulfilment Rate = Completed ÷（Completed + Cancelled + No-show）
- Cancellation Rate = Cancelled ÷（Completed + Cancelled + No-show）
- No-show Rate = No-show ÷（Completed + Cancelled + No-show）

员工和服务筛选直接使用 Appointment 的实际员工和服务快照；门店筛选使用 Appointment 的 `location_id`。

## 4.4 图表二：各门店和服务销售额

建议使用横向柱状图，并允许在同一图表内切换：

- 按门店查看净销售额
- 按服务查看净销售额
- 按零售商品查看净销售额

数据来源为已付款或已退款的 Salon Service Order/Appointment Payment：

- Gross Sales：实际确认的服务销售额
- Refunds：已退款金额
- Net Sales：Gross Sales - Refunds

收入日期沿用现有财务口径：Paid 使用 `verified_at` 或 `paid_at`，Refund 使用 `refunded_at`。免费服务不计收入，但仍计入 Appointment 和员工业绩数量。

必须使用服务标题、门店名称和员工姓名快照，避免历史主档改名后报表变化。Package、Membership、Class 和 Event 收入不混入 Salon Service Sales。POS 零售商品以独立的 Retail Product 切换视图显示，使用同一日期、门店和员工筛选，不能把商品收入归到某个美容服务。

Sales Report 另外提供所选期间与上一年度相同期间的 Gross、Refund 和 Net Sales 对比，并计算 YoY Growth。上一年度分母为零时显示 N/A，不能显示无穷大或误导百分比。

## 4.5 图表三：新客户与回头客

建议使用按日或按周的分组柱状图，显示：

- New Customers
- Returning Customers

统一定义：

- **New Customer**：在当前 Studio 第一次完成 Salon 服务的日期落在所选范围内。
- **Returning Customer**：在所选范围内完成服务，并且在本次服务前已经有至少一次 Completed Salon Appointment。
- 同一客户在同一天完成多项服务时，每个周期只计一次客户人数，避免重复计算。
- Walk-in 客户注册或合并后仍使用同一个 `salon_customer_id`，不能重新被计算为新客户。

门店、员工和服务筛选决定当前图表统计哪些已完成 Appointment，但客户是否“新客”应根据该客户在整个 Studio 的历史首次完成服务判断，不能因切换员工或门店就重新变成新客户。

同时提供：

- Unique Customers
- New Customer Rate
- Repeat Visit Rate
- Average Visit Frequency（可作为辅助指标）

Q3 CRM 报表统一增加：

- **Frequency of Visit (FOV)**：所选期间 Completed Salon Visits ÷ Unique Customers。
- **New Client Retention**：首次 Completed Salon Service 落在指定 Cohort 期间的客户中，在首次服务后 90 天内再次完成服务的比例；尚未完整经过 90 天观察期的 Cohort 标记为 Incomplete，不混入最终比例。
- **Repeat Client Retention**：上一可比较期间已有至少两次历史完成服务的客户中，在当前同长度期间再次完成服务的比例。

Retention 报表必须显示 Cohort 起止日期、观察窗口、分子、分母和 Incomplete 数量。由于本次 Q9 回答 No，Dashboard 不显示或宣称 Client Loyalty Points。

## 4.6 图表四：员工业绩与佣金

建议使用组合柱状图或双指标横向柱状图，至少显示每位员工：

- Completed Services
- Net Service Sales
- Earned Commission

数据来源：

- Completed Appointment 和 Service Order：服务数量和销售归属
- Payment/Refund：实际净销售额
- `service_commission_entries`：佣金和退款冲回

佣金采用已生成并可追溯的 Commission Entry，不在 Dashboard 页面临时重新计算。Draft、Approved 和 Reversed 佣金应有清晰状态；默认显示所选日期内已赚取净佣金，并允许报表明细查看来源。

选择某个员工后，图表仍然保留并只显示该员工，同时其他三个图表也使用同一个员工筛选。

## 4.7 顶部 KPI

KPI 卡片不计入“至少四个图表”，只能作为辅助摘要。建议显示：

- Completed Appointments
- Fulfilment Rate
- Net Service Sales
- Unique Customers
- New Customers
- Net Commission

每张 KPI 使用与四个图表完全相同的筛选条件和数据口径。

## 4.8 统一报表数据层

建议建立数据库聚合函数或 Reporting View，避免四个图表分别写一套容易不一致的查询。

统一数据至少包含：

- Studio
- Location
- Salon Customer
- Appointment
- Service
- Employee
- Service Order
- Payment 和 Refund
- Commission Entry
- Appointment 状态和业务时间
- 服务、员工和门店快照

建议新增：

- `salon_reporting_facts` View：统一 Appointment、Service Order、Payment 和 Commission 维度；也可以使用等效的安全 SQL View。
- `get_salon_dashboard` 数据库函数：一次接收全部筛选和授权门店范围，返回四组图表与 KPI 数据。
- `/api/dashboard/salon-analytics`：验证筛选参数和权限后调用数据库函数。

数据库函数必须接收已验证的 Studio 和 Location Scope，不能让前端自由传入任意门店。不要继续使用 `.limit(5000)` 的明细读取方式生成 Dashboard。

## 4.9 数据时间和状态口径

- Appointment 图表：按服务开始时间的 SGT 日期统计。
- New/Returning Customer：按 Completed Appointment 的服务日期统计。
- Sales：Paid 按 `verified_at/paid_at`，Refund 按 `refunded_at`。
- Commission：只有服务已完成且对应 POS 服务明细已付款后才成为 Earned，按服务完成日期统计；退款冲回保留原来源和冲回日期。
- Cancelled 和 No-show 预约不能计入 Completed Services、Sales 或 Commission。
- Refunded Payment 必须减少 Net Sales 和相应 Commission。
- 未分配门店、员工或服务的历史数据单独标记为 Unassigned，不能静默归类。

所有百分比在分母为零时显示 0 或 N/A，不能出现除零错误。

## 4.10 页面和图表实现

- 继续使用 `/dashboard/reports`，顶部增加 Salon Dashboard 区域。
- 保留现有财务统计卡和 Revenue by day 表格，放到 Salon Dashboard 下方作为明细。
- 当前项目没有 Chart Library。第一版可使用轻量 SVG/CSS 图表组件，避免为了四张简单图表增加大型依赖。
- 每张图表必须响应式支持桌面和手机。
- 图表同时提供表格形式的数据摘要，方便审核人员核对，也满足键盘和屏幕阅读器使用。
- 图例、颜色和标签必须明确，不能只依赖颜色区分状态。
- 无数据时显示清楚的 Empty State，而不是空白图表。
- 页面显示数据更新时间和当前筛选范围。

## 4.11 导出和报表明细

提供与当前筛选完全一致的业务数据导出：

- Appointment Outcome Report
- Location/Service Sales Report
- New and Returning Customer Report
- Employee Performance and Commission Report

至少统一支持 CSV、XLSX、XML 和 TSV，文件内容、字段和筛选口径一致。XLSX 应使用维护良好的服务器端库生成，不能把 CSV 文件改扩展名冒充 XLSX。

导出接口必须复用页面权限、日期、门店、员工和服务筛选。一般经营导出不能包含客户健康、过敏和疗程内部备注；大数据量导出使用受控后台任务或流式响应，不能因一次请求读取全部数据而耗尽内存。

## 4.12 权限

- Owner：查看单店、全部门店和门店对比。
- Global Manager：查看授权 Studio 的全部门店。
- Location Manager：只查看授权门店。
- Frontdesk、Employee、Customer：默认不能进入经营 Dashboard。

所有权限在服务端和数据库查询中执行，不能只依赖隐藏导航菜单。导出权限必须与页面权限一致。

## 4.13 性能和准确性

- 为 Appointment 的 Studio、Location、Employee、Service、Start Time 和 Status 建立组合索引。
- 为 Service Order、Payment 和 Commission 的业务关联与时间字段建立索引。
- 使用数据库聚合，不把全部明细载入 Next.js 后再计算。
- 同一筛选下四张图和 KPI 应来自同一次一致性查询或相同数据快照。
- 新建、完成、取消、退款或佣金调整后，应重新验证/刷新相关报表缓存。
- 金额统一使用数据库 Numeric，不能使用浮点数累计财务数据。

## 4.14 测试和过审验收

提交前至少验证：

- 页面始终显示四个实际图表，KPI 卡片不冒充图表。
- 日期、门店、员工和服务四个筛选都会同时改变四张图和 KPI。
- Location-scoped Manager 不能通过 URL 或 API 查看其他门店。
- All locations 总数等于各门店汇总，并单独显示 Unassigned 历史数据。
- Appointment 完成、取消和爽约比例计算正确。
- 同一客户一天多项服务不会被重复计算为多个 New Customer。
- 客户跨门店消费时，首次服务定义仍以整个 Studio 历史为准。
- Payment Refund 会减少 Net Sales，并正确冲回佣金。
- Service、Employee 或 Location 改名后历史图表仍使用业务快照。
- 数据超过 5,000 笔后报表仍然完整准确。
- 四份报表的 CSV、XLSX、XML 和 TSV 与页面筛选和图表数据一致，并能被对应软件正常打开。
- 空数据、零分母、跨月和新加坡日期边界正确。

## 4.15 Q3 各领域报表数量和申报说明

申请表 Q3 需要填写各领域现有报表数量。PSG Core Edition 完成后建议按实际页面填写：

- Appointment Scheduling：1 个 Appointment Outcome Dashboard/Report。
- Sales Analysis：至少 4 个视图/报表——Outlet Sales、Service Sales、Retail Product Sales、YoY Sales Comparison。
- CRM：至少 4 个视图/报表——New Clients、New Client Retention、Repeat Client Retention、Frequency of Visit。
- Employee Management：2 个报表——Employee Performance、Commission Report。
- Inventory Management：0；Q20 回答 No，不申报 Stock Movement、Stock Balance 或 Low Stock Report。
- Package Management：1 个 Package Balance Value Report；仅在 Q11–Q12 完成并回答 Yes 后申报。
- Loyalty：0；Q9 回答 No，不申报 Loyalty Points Report。

Package Balance Value 使用购买时的净价和总 Credits 快照，按尚未使用 Credits 分摊计算未使用套餐价值，并分别显示未过期、即将到期和已过期未处理金额。该报表是业务运营口径；如用于正式会计 Deferred Income，必须由会计师确认收入确认和退款规则。

上述数量只能在对应页面、筛选、明细和导出都完成后填写，不能把同一张表换名字重复计算数量。

正式技术演示流程：准备两家门店、两名员工、两项服务及新老客户数据 → 打开本月 All locations Dashboard → 展示四张图 → 依次切换日期、门店、员工和服务并证明四张图同时更新 → 展示退款对净销售和佣金的影响 → 导出四份对应报表并与页面数字核对。

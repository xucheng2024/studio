# FND-03：服务与门店发布

状态：已上线

Commit：`6c40e3d`

Branch / Remote：`main` / `origin/main`

## 已确认存在的实现

- `studio_services` 保持 Studio 总部服务主档，并增加 All Locations / Selected Locations 发布范围。
- `service_locations` 保存 Service、Location、Studio、启用状态、是否使用总部默认值，以及价格、时长和缓冲覆盖值。
- Trigger 验证 Service、Location、Studio 一致，跨 Studio 或不一致组合由数据库拒绝。
- 新建 All Locations 服务时为现有门店建立发布记录；新建门店时自动接收 All Locations 服务。
- 支持全店发布、指定门店发布、单店停用和单店覆盖值。
- 支持总部价格的 `hq_only`、`all_locations`、`selected_locations` 三种传播模式。
- 复用 `operation_audits` 记录发布范围、启用状态、覆盖值和总部价格 before/after。
- 新表启用 RLS，anon/authenticated/PUBLIC 无表权限；SECURITY DEFINER 函数固定 `search_path` 并只授予 `service_role`。
- `src/lib/service-locations.ts` 在使用 Admin Client 前重新验证 Studio、Location 和角色范围。

## 回填策略

现有服务按迁移前的实际兼容语义回填到同 Studio 的全部现有门店：`is_enabled = true`、使用总部默认值、不猜测任何门店覆盖值。该过程只新增关联记录，不删除服务、门店或静默修改价格，并使用唯一约束及 `ON CONFLICT DO NOTHING` 支持重跑。

## 本任务明确不包含

- `service_employees`：移到 APT-01
- Appointment、资源、工作时间和排班
- POS、Package 和 `service_orders.location_id`
- 服务管理页面的大改造

## 当前交付文件

- `supabase/migrations/20260811124428_fnd03_service_location_publish.sql`
- `src/lib/service-locations.ts`

## 完成证据和后续边界

- 本地 `main`、`origin/main` 和 `origin/HEAD` 已核对指向 `6c40e3d`。
- Commit 只包含本任务的 Migration 和服务端库，共 1024 行新增，没有夹带 FND-01/FND-02 或其他模块改动。
- Migration 执行返回 `service_location_rows_created: 47`，现有服务与门店关系已完成兼容回填。
- 当前 `studio_services` 的总部默认值只有价格。标准时长和缓冲属于 Salon Appointment Availability 契约，明确由 APT-01 增加并复用 FND-03 的门店覆盖结构；不再作为 FND-03 阻塞项。
- 完整的历史测试命令输出应继续保存在 FND-03 原交付记录或 CI/终端记录中；本次文档更新没有重新运行数据库测试。

## 后续稳定接口

验收通过后，APT、POS、Package 和 Reporting 只能通过 `service_locations` 判断门店是否提供服务，并在业务发生时保存当时有效的价格/时长快照；不能只读取 `studio_services` 或重新发明门店服务关系。

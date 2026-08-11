# FND-01：统一 Employee 身份

状态：已上线

Commit：`522ef18`

## 已确认实施内容

- `employees` 作为 Studio 内雇佣主档，可选关联现有用户和 Instructor。
- `employee_locations` 支持一名员工在多个门店工作，并限制每名员工最多一个 Primary Location。
- `staff_memberships` 继续只表示登录和系统访问权限，没有被改成雇佣记录。
- 数据库验证 Employee、Instructor、Location 和 Studio 一致。
- 唯一索引防止同一用户或 Instructor 被重复关联。
- 迁移现有 Instructor/Staff 时只处理安全匹配，无法确定的记录进入 `employee_migration_conflicts`。
- RLS、函数权限和服务端 `src/lib/employees.ts` 提供后续模块的最小读取及工作门店更新能力。

## 明确未包含

- Appointment、可用时间和排班
- `service_employees`
- 佣金、薪资和 Payroll
- 员工 HR 页面完整改造

## 交付文件

- `supabase/migrations/124_employee_foundation.sql`
- `src/lib/employees.ts`

## 当前确认边界

本记录依据已上线 Commit 和当前代码结构确认功能存在。本轮文档整理没有重新执行 Migration、RLS 或角色矩阵测试；历史验证结果应在发布记录中继续保留。后续任务不得修改或重新建立 Employee 身份模型，只能通过新 Migration 兼容扩展。

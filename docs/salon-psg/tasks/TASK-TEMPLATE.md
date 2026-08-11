# TASK-ID：任务名称

状态：未开始

负责人：

开始日期：

完成日期：

Commit / Release：

## 1. 目标

用一段话说明本任务完成后新增的可验证业务能力。

## 2. 开始前必须阅读

- `AGENTS.md`
- `docs/salon-psg/00-development-guide.md`
- `docs/salon-psg/10-development-backlog.md` 对应任务
- 对应模块文档章节
- 直接相关的现有 Schema、RLS、Server Action、权限工具
- 实际改动涉及的 Next.js 16 本地文档

## 3. 依赖与输入契约

- 已完成依赖：
- 复用的数据身份：Studio / Location / Customer / Employee / Service
- 仍需产品或外部确认：

## 4. 本任务必须完成

- 数据库：表、列、约束、索引、RLS、RPC、Migration/回填
- 服务端：读取、Mutation、Scope 二次验证
- 页面或接口：仅列本任务需要的最小入口
- 审计/幂等：
- 兼容性：

## 5. 明确不做

- 列出相邻任务和本任务禁止扩大的范围。

## 6. 权限矩阵

| 操作 | Owner | Global Manager | Location Manager | Frontdesk | Instructor/Employee | Customer | anon |
|---|---|---|---|---|---|---|---|
| 示例读取 |  |  |  |  |  |  |  |
| 示例修改 |  |  |  |  |  |  |  |

所有 Location-scoped Mutation 必须在数据库和服务端分别验证 Studio/Location/Role，不以页面隐藏代替授权。

## 7. Migration 和回填

- Migration 文件：必须由 Supabase CLI 生成。
- 现有数据策略：
- 冲突/异常报告：
- 可重跑策略：
- 回滚或上线风险：

## 8. 验收场景

- [ ] 正常成功路径
- [ ] Studio 隔离
- [ ] Location Scope 允许/拒绝
- [ ] 角色允许/拒绝
- [ ] 数据库约束拒绝非法组合
- [ ] 重复调用/并发安全（如适用）
- [ ] Migration 在空库、现有数据及二次执行通过
- [ ] `npx tsc --noEmit`
- [ ] 相关 ESLint/测试
- [ ] anon/authenticated/service_role 表与 RPC 权限矩阵

## 9. 实际交付

### 修改文件

### 数据库变化

### 验证结果

### 未解决风险

没有实际命令输出或测试证据时，不勾选对应项目。

## 10. 后续任务接口

列出下一个任务可以依赖的稳定表、函数、类型和禁止假设。

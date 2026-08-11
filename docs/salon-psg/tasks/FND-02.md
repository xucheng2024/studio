# FND-02：统一 Salon Customer 身份

状态：已上线

Commit：`6ba056e`

## 已确认实施内容

- `salon_customers` 作为 Studio 内 Salon 客户主档，可选关联登录用户和偏好门店。
- 数据库验证客户、Merge 目标、用户及 Location 的 Studio 一致性。
- 支持现有 Member/Guest 的谨慎回填、重复候选提示及迁移冲突记录。
- `salon_customer_merge_audits` 保存人工合并证据。
- Guest Link/Merge RPC 兼容现有客户登录和历史记录归并流程。
- RLS、函数权限和服务端 `src/lib/salon-customers.ts` 提供 Scoped List/Get/Create/Update/Merge 能力。

## 明确未包含

- 健康状况、过敏、禁忌和敏感资料
- Treatment、Follow-up 和 Appointment 历史模型
- Marketing Consent 完整流程
- 客户页面完整改造

## 交付文件

- `supabase/migrations/20260811111549_salon_customer_foundation.sql`
- `src/lib/salon-customers.ts`

## 当前确认边界

本记录依据已上线 Commit 和当前代码结构确认功能存在。本轮文档整理没有重新执行 Migration、RLS 或角色矩阵测试。CRM-01/CRM-02 必须扩展该主档，不能另建第二套客户身份。

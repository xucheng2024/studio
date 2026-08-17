# Salon PSG Q1–Q35 申请对照表

状态说明：✅ 当前基本满足；🟡 已有基础但需开发/补证据；❌ 当前不满足；⚪ 计划回答 No 或条件题不触发；🔴 外部强制条件，不能只靠开发完成。

“目标答案”只表示当前方案计划。正式提交前必须按生产版本、书面确认和证明材料重新核对，不能因为文档写 Yes 就直接申报。

| 问题 | 当前状态 | 目标答案 | 按当前方案需要完成的内容 |
|---|---|---|---|
| Q1 云端及多设备 | ✅ 基本满足 | Yes | 保持响应式 Web/PWA 和云端单一数据源；准备桌面、平板/手机浏览器及同账号数据同步截图。PWA 不在这里宣称为独立 Mobile App。 |
| Q2 多门店集中管理 | 🟡 部分满足 | Yes | `FND-01`、`FND-03` 完成员工多门店和服务发布基础；还需 `APT-01`/`APT-02`、`POS-01` 和 `RPT-01`/`RPT-02` 分别保证预约、销售真实归店以及单店/全部门店汇总。全部完成并通过越权测试后才能判定 Q2 满足。 |
| Q3 Dashboard / Reports | ❌ 不满足 | Yes | 完成 `RPT-01`、`RPT-02`：四个真实互动图表，公共筛选同时作用；并提供 Appointment Outcome、Outlet/Service/Retail/YoY Sales、New/Repeat Retention、FOV、Employee/Commission 和 Package Balance Value 报表。Inventory、Loyalty 按未启用模块填 0。 |
| Q4 Appointment Scheduling | 🟡 已验证/待上线 | Yes | `APT-01` 至 `APT-03` 已实现一对一 Salon Appointment、员工时间、房间/床位/设备、跨门店冲突、状态、取消/改期和原子占用；2026-08-17 隔离 Free cloud UAT 已覆盖 APT-01 角色拒绝/390px 配置写入与 APT-03 日历主路径/跨门店拒绝。待生产发布窗口与申请截图后确认满足。现有课程 Session 不作为证据。 |
| Q5–Q6 Online Booking | 🟡 模块存在但不完整 | Yes | 完成 `APT-05` 与分段 `APT-04`：先交付安全登录、实时档期、客户本人预约/取消/改期和 Terms，再联合 `PKG-01`、`POS-03` 接入 Package Credits、订金或全额付款及通知。 |
| Q7 Customer Management | 🟡 已实现待证据收口 | Yes | `FND-02`、`CRM-01`、`CRM-02` 已覆盖 Studio-scoped Customer、偏好、过敏、健康/禁忌、疗程历史、Follow-up、Consent 和敏感权限；CRM-02 已上线，补齐 CRM-01 最终上线状态与申请截图后确认满足。 |
| Q8 实时同步 | ✅ 基础满足 | Yes | Supabase 继续作为单一数据源；所有新模块写入同一业务数据关系。准备两个设备同时更新客户、预约或销售并即时看到一致结果的演示证据。 |
| Q9–Q10 Loyalty | ⚪ 本次不做 | No（Q10 不触发） | Membership、Package 和简单 Credits 不描述成 Loyalty Points。若 Q9 回答 No，避免触发 Q10 的积分、兑换、等级等强制功能。 |
| Q11–Q12 Package | 🟡 模块存在但不完整 | 完成后 Yes | 保留现有 Class Pass、公开购买、HitPay 和 Booking 扣减；先以 `POS-01` 统一 Package Sale Item，再由 `PKG-01`、`PKG-02` 增加 Salon Customer/Service/Location、opening-balance 迁移、余额与价值 Ledger、人工调整、maker-checker 审批和完整审计。未完成前不能填 Yes。 |
| Q13 收据和付款记录 | ✅ 基本满足 | Yes | 现有 Payment、编号、PDF Invoice 和退款可复用；完成 POS 后提供多项目 Receipt、Refund Receipt/Credit Note、门店/员工/付款方式和审计。 |
| Q14 数字支付 | ✅ 基本满足 | Yes | 使用现有 HitPay 和 Cash；申请材料只列出生产环境真实启用并可现场完成的 HitPay 支付方式，保留 Webhook、同步及退款证据。 |
| Q15 POS | 🟡 部分满足 | Yes | 复用现有 Payment、HitPay、Invoice、Service/Shop/Package 购买基础，完成 `POS-01` 至 `POS-04`：客户、多服务/商品/套餐购物车、员工、折扣、Cash/HitPay、收据、退款/作废、库存与 Package 联动、门店归属和日结。申报为 in-house POS。 |
| Q16 SMS / E-Marketing | ⚠️ 已实现/待目标环境验证 | Yes（路径已确认） | `MKT-01`、`MKT-02` 已实现 VIP/常客/长期未到店、Email Builder、图片/CTA、Email 立即或预约发送、Resend Webhook、重试、成功率、点击率和退订；待真实 Resend 送达证据。SMS、WhatsApp 不做。 |
| Q17 HR Management | ❌ 尚未开发 | Yes（自建已确认） | 已确认可使用 in-house Payroll。完成 `FND-01`、`COM-01`、`PAY-01` 至 `PAY-03`：员工档案、自助更新、佣金、Payroll、报告、MOM Itemised Payslip 和法定规则版本，并由专业人士验证计算。 |
| Q18 IRAS AIS | ⚪ 本次不做 | No | 已确认 Q18 回答 No 不影响 Q17。不得宣称在 IRAS Supporting Payroll Software Vendors 名单中。 |
| Q19 Leave / Attendance / Roster | ⚪ 本次不做 | No | 员工工作时间只用于 Appointment Availability，不描述成完整 Roster、Attendance 或 Leave Management。 |
| Q20–Q23 Inventory | ⚪ 建议不触发 | Q20 No；Q21–Q23 不触发 | `shop_products.stock_qty` 和 POS 商品扣减仅作为基础商品数量，不申报完整 Inventory。避免触发库存主档、Journal、Warehouse、实时集成和低库存提醒全部强制要求。 |
| Q24–Q25 Mobile App | ⚪ 建议不触发 | Q24 No；Q25 不触发 | 当前为响应式 Web/PWA，不宣称独立 Mobile App；只有取得 IMDA 书面确认并具备对应模块后才改变答案。 |
| Q26–Q27 AI | ⚪ 本次不做 | Q26 No；Q27 不触发 | 不把普通筛选、自动计算、提醒或规则引擎描述成 AI。 |
| Q28 Business Data Extraction | 🟡 部分满足 | Yes | 当前只发现 Payment CSV 导出，不足以覆盖完整业务。完成 `EXP-01`，按权限和相同筛选导出 Appointment、Customer、Sales、Package、Commission、Payroll 等数据，统一支持 CSV、XLSX、XML、TSV，并验证文件可用性。 |
| Q29 Personal Data Protection | 🟡 部分基础 | Yes，但需正式表格和证据 | 完成 `CMP-01`：隐私告知/Consent、访问更正、保留、删除/匿名化、敏感权限、访问/导出审计、第三方处理者记录等；必须由负责人完成题目指定的 PDPA Requirements Form。仅有 RLS 不足以证明完整合规。 |
| Q30 VA/PT | 🔴 当前没有合格报告证据 | Yes，否则不能继续 | 联系符合题目资格的独立第三方，在提交前 12 个月内完成规定范围的 VA/PT。必须包含执行摘要、详细发现/风险、修复建议、方法、范围、资格及修复/缓解证据。主要功能稳定后测试，给修复和复测预留时间。 |
| Q31 Product Principal | 🟡 需公司确认 | 自研产品通常 Yes | 如果申请公司拥有并负责本解决方案，走 Product Principal 路径；若只是转售第三方产品则回答 No 并转 Q34。公司负责人确认，不能由代码推断。 |
| Q32–Q33 Product Principal Cybersecurity Certification | 🔴 组织级事项 | 有证书则 Yes；否则按当期规则 No | Product Principal 应规划 Cyber Essentials for ICT Vendors、Cyber Trust Mark、ISO 27001 或认可等效认证。当前指南说明申请时鼓励、Annual Review 时转为强制；回答 Yes 才触发 Q33 上传证书、范围和日期。 |
| Q34–Q35 Reseller Cybersecurity Certification | ⚪ 仅 Reseller 路径 | 取决于 Q31 | 只有 Q31 回答 No 才进入。Reseller 按相同原则准备自身认可认证；回答 Yes 后 Q35 必须上传证书、范围和日期。 |

## 当前代码证据摘要

- Q3：`src/app/(app)/dashboard/reports/page.tsx` 当前主要为过滤器、数字卡和 Revenue 表格，没有四个 Salon 图表。
- Q7：客户详情已包含 CRM-01 敏感资料和 CRM-02 Treatment/Follow-up；仍需统一保存最终生产验收与申请截图证据。
- Q11–Q12：现有 `packages` / `client_packages`、公开购买、HitPay Paid 发放和 Class Booking consume/return 可复用，但余额仍以可变 `credits_left` 为主，缺 Salon Customer/Service 适用关系、append-only Ledger、调整审批和 deferred value。
- Q17：`src/app/(app)/dashboard/staff/page.tsx` 当前管理账号角色和访问权，不是 Employee HR/Payroll 主档。
- Q28：当前可见的正式业务导出主要是 `/api/payments/export` CSV，尚未形成跨模块、多格式 Export Service。
- Q30：仓库中没有发现可以替代合资格第三方 VA/PT 报告的材料；内部安全检查或自动扫描不能冒充 Q30 报告。

## 申请前硬性闸门

以下任一未完成，都不建议提交：

1. 所有计划回答 Yes 的 Q1–Q17 功能已在生产等效环境真实可操作。
2. Q16、Q17 的确认回复已保存完整截图、回复人、日期和上下文，产品、报价和演示已按 Email-only 与 in-house Payroll 调整。
3. Q28 多格式导出已完成且权限正确。
4. Q29 官方 PDPA Form 已填写，系统证据与答案一致。
5. Q30 合格第三方 VA/PT 报告在有效期内，重要发现已修复或有被接受的缓解方案。
6. Q31–Q35 已按真实 Product Principal/Reseller 身份选择，并规划 Annual Review 认证要求。

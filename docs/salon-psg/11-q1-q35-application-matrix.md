# Salon PSG Q1–Q35 申请对照表

状态说明：✅ 当前基本满足；🟡 已有基础但需开发/补证据；❌ 当前不满足；⚪ 计划回答 No 或条件题不触发；🔴 外部强制条件，不能只靠开发完成。

“目标答案”只表示当前方案计划。正式提交前必须按生产版本、书面确认和证明材料重新核对，不能因为文档写 Yes 就直接申报。

| 问题 | 当前状态 | 目标答案 | 按当前方案需要完成的内容 |
|---|---|---|---|
| Q1 云端及多设备 | ✅ 基本满足 | Yes | 保持响应式 Web/PWA 和云端单一数据源；准备桌面、平板/手机浏览器及同账号数据同步截图。PWA 不在这里宣称为独立 Mobile App。 |
| Q2 多门店集中管理 | 🟡 已上线 / 待申请截图 | Yes | `FND-01`、`FND-03`、`APT-01`/`APT-02`、`POS-01` 与 `RPT-01`/`RPT-02` 已进入生产：预约/销售归店，Reports 日期/门店/员工/服务筛选可汇总单店与全部门店。申请截图与越权演示后确认满足。 |
| Q3 Dashboard / Reports | 🟡 已上线 / 待申请截图 | Yes | `RPT-01`、`RPT-02` 已进入生产：Appointment Outcome、Sales Trend、Revenue by Service、Employee Commission/Productivity 四图，以及 Retention/FOV/YoY 与既有 Revenue/Deferred 报表。Inventory、Loyalty 按未启用模块填 0。Surgery 当前无 2026-08 销售数据。申请截图后确认满足。 |
| Q4 Appointment Scheduling | 🟡 已上线 / 待申请截图 | Yes | `APT-01` 至 `APT-03` 已进入生产（`61dbdf0`，gate `32086736757`）。隔离 Free cloud UAT 已覆盖 APT-01 角色拒绝/390px 配置写入与 APT-03 日历主路径/跨门店拒绝。申请截图后确认满足。现有课程 Session 不作为证据。 |
| Q5–Q6 Online Booking | 🟡 已上线 / 待申请截图 | Yes | `APT-04`、`APT-05` 已进入生产（`61dbdf0`）。覆盖安全登录、实时档期、客户本人预约/取消、Package Credits 与订金 Sandbox。申请截图与现场演示后确认满足。 |
| Q7 Customer Management | 🟡 已上线 / 待申请截图 | Yes | `FND-02`、`CRM-01`、`CRM-02` 已进入生产。覆盖 Studio-scoped Customer、偏好、过敏、健康/禁忌、疗程历史、Follow-up、Consent 和敏感权限。申请截图后确认满足。 |
| Q8 实时同步 | ✅ 基础满足 | Yes | Supabase 继续作为单一数据源；所有新模块写入同一业务数据关系。准备两个设备同时更新客户、预约或销售并即时看到一致结果的演示证据。 |
| Q9–Q10 Loyalty | ⚪ 本次不做 | No（Q10 不触发） | Membership、Package 和简单 Credits 不描述成 Loyalty Points。若 Q9 回答 No，避免触发 Q10 的积分、兑换、等级等强制功能。 |
| Q11–Q12 Package | 🟡 已上线 / 待申请截图 | 完成后 Yes | `PKG-01`、`PKG-02` 已进入生产（`61dbdf0`）。覆盖 Salon Customer/Service/Location、opening-balance Ledger、maker-checker 审批。部分 package refund 与 Guest `user_id is null` 发放仍不在范围。申请截图后确认满足。 |
| Q13 收据和付款记录 | ✅ 基本满足 | Yes | 现有 Payment、编号、PDF Invoice 和退款可复用。已付款 POS 明细可 Preview/Send invoice（`4c2a69f`）。找零 UI 与独立 Credit Note 号段仍未做。 |
| Q14 数字支付 | ✅ 基本满足 | Yes | 使用现有 HitPay 和 Cash；申请材料只列出生产环境真实启用并可现场完成的 HitPay 支付方式，保留 Webhook、同步及退款证据。 |
| Q15 POS | 🟡 已上线 / 待申请截图 | Yes | `POS-01` 至 `POS-04` 已进入生产（`61dbdf0`）。已付款 POS 可发送 PDF invoice。找零 UI 与 Void 点击证据仍不在本批。申请截图与现场演示后确认满足。 |
| Q16 SMS / E-Marketing | 🟡 已上线 / 待申请截图 | Yes（路径已确认） | `MKT-01`、`MKT-02` 已进入生产（`61dbdf0`）。Owner 已启用 Surgery 店 Email settings，受控测试邮件已通。SMS、WhatsApp 不做。申请截图后确认满足。 |
| Q17 HR Management | 🟡 已上线 / 待申请截图 | Yes（自建已确认） | `FND-01`、`COM-01`、`PAY-01` 至 `PAY-03` 已上线：受限薪资档案、四状态跑批、MOM Itemised Payslip（查看/打印/PDF/Email）、员工本人查看、Payroll/Commission/Statutory 报表。Email 不在 Finalise 时自动发送。申请截图后确认满足。 |
| Q18 IRAS AIS | ⚪ 本次不做 | No | 已确认 Q18 回答 No 不影响 Q17。不得宣称在 IRAS Supporting Payroll Software Vendors 名单中。 |
| Q19 Leave / Attendance / Roster | ⚪ 本次不做 | No | 员工工作时间只用于 Appointment Availability，不描述成完整 Roster、Attendance 或 Leave Management。 |
| Q20–Q23 Inventory | ⚪ 建议不触发 | Q20 No；Q21–Q23 不触发 | `shop_products.stock_qty` 和 POS 商品扣减仅作为基础商品数量，不申报完整 Inventory。避免触发库存主档、Journal、Warehouse、实时集成和低库存提醒全部强制要求。 |
| Q24–Q25 Mobile App | ⚪ 建议不触发 | Q24 No；Q25 不触发 | 当前为响应式 Web/PWA，不宣称独立 Mobile App；只有取得 IMDA 书面确认并具备对应模块后才改变答案。 |
| Q26–Q27 AI | ⚪ 本次不做 | Q26 No；Q27 不触发 | 不把普通筛选、自动计算、提醒或规则引擎描述成 AI。 |
| Q28 Business Data Extraction | 🟡 已上线 / 待申请截图 | Yes | `EXP-01` 已进入生产：Deferred、Sales、Customers、Packages 与 Payroll/Commission 四格式同步导出；权限与敏感字段过滤在应用层。不建设异步导出平台。申请截图与样例文件后确认满足。 |
| Q29 Personal Data Protection | 🟡 部分基础 | Yes，但需正式表格和证据 | 完成 `CMP-01`：隐私告知/Consent、访问更正、保留、删除/匿名化、敏感权限、访问/导出审计、第三方处理者记录等；必须由负责人完成题目指定的 PDPA Requirements Form。仅有 RLS 不足以证明完整合规。 |
| Q30 VA/PT | 🔴 当前没有合格报告证据 | Yes，否则不能继续 | 联系符合题目资格的独立第三方，在提交前 12 个月内完成规定范围的 VA/PT。必须包含执行摘要、详细发现/风险、修复建议、方法、范围、资格及修复/缓解证据。主要功能稳定后测试，给修复和复测预留时间。 |
| Q31 Product Principal | 🟡 需公司确认 | 自研产品通常 Yes | 如果申请公司拥有并负责本解决方案，走 Product Principal 路径；若只是转售第三方产品则回答 No 并转 Q34。公司负责人确认，不能由代码推断。 |
| Q32–Q33 Product Principal Cybersecurity Certification | 🔴 组织级事项 | 有证书则 Yes；否则按当期规则 No | Product Principal 应规划 Cyber Essentials for ICT Vendors、Cyber Trust Mark、ISO 27001 或认可等效认证。当前指南说明申请时鼓励、Annual Review 时转为强制；回答 Yes 才触发 Q33 上传证书、范围和日期。 |
| Q34–Q35 Reseller Cybersecurity Certification | ⚪ 仅 Reseller 路径 | 取决于 Q31 | 只有 Q31 回答 No 才进入。Reseller 按相同原则准备自身认可认证；回答 Yes 后 Q35 必须上传证书、范围和日期。 |

## 当前代码证据摘要

- Q3：`RPT-01`/`RPT-02` 已上线。`/dashboard/reports` 有四图与 Salon facts；Surgery 2026-08 空结果为真实数据。
- Q7：客户详情已包含 CRM-01 敏感资料和 CRM-02 Treatment/Follow-up；2026-08-18 已进入生产（`61dbdf0`）。仍需申请截图。
- Q11–Q12：`PKG-01`/`PKG-02` 已进入生产，含 append-only Ledger 与 maker-checker。部分 package refund 与 Guest `user_id is null` 发放仍不在范围；仍需申请截图。
- Q17：Owner `/dashboard/payroll`、员工 `/dashboard/payroll/me` 与 Payslip/报表已上线；隔离 UAT `pay01-payroll-local` 已通过。Staff Access 仍只管角色。已发布工资单可 Email PDF（`4c2a69f`），不自动群发。
- Q28：`EXP-01` 已上线。`/api/reports/business/export` 覆盖 Sales/Customers/Packages 四格式；Deferred 与 Payroll/Commission 沿用既有导出。申请截图仍待补。
- Q30：仓库中没有发现可以替代合资格第三方 VA/PT 报告的材料；内部安全检查或自动扫描不能冒充 Q30 报告。

## 申请前硬性闸门

以下任一未完成，都不建议提交：

1. 所有计划回答 Yes 的 Q1–Q17 功能已在生产等效环境真实可操作。
2. Q16、Q17 的确认回复已保存完整截图、回复人、日期和上下文，产品、报价和演示已按 Email-only 与 in-house Payroll 调整。
3. Q28 多格式导出已完成且权限正确。
4. Q29 官方 PDPA Form 已填写，系统证据与答案一致。
5. Q30 合格第三方 VA/PT 报告在有效期内，重要发现已修复或有被接受的缓解方案。
6. Q31–Q35 已按真实 Product Principal/Reseller 身份选择，并规划 Annual Review 认证要求。

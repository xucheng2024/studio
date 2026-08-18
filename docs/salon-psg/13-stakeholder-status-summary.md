# Salon PSG 全部要求、当前状态与解决方案

这份表用于向合伙人、申请顾问和非技术人员说明整体情况。状态基于当前代码，不代表功能写在计划中就已经满足。详细技术设计见各模块文档，官方问题原文见 [Q1–Q35 Requirements Source](./12-submitted-requirements-source.txt)。

状态说明：✅ 当前基本满足；🟡 有基础但需要补；❌ 当前不满足；⚪ 可选项目计划回答 No；🔴 外部材料或认证，不能只靠开发完成。

| 问题 | 当前状态 | 解决方案 | 申报建议 |
|---|---|---|---|
| Q1 云端/多设备 | ✅ 基本满足 | 继续使用云端响应式 Web/PWA，准备桌面、平板和手机浏览器截图，并演示同一账号的数据同步。 | Yes |
| Q2 多门店集中管理 | 🟡 部分满足 | 保留现有 Location；增加服务发布到全部/指定门店、员工多门店归属、所有业务强制记录门店，以及单店/全部门店合并报表。 | 完成后 Yes |
| Q3 Dashboard/Reports | ❌ 不满足 | 建立至少4张互动图表，统一使用日期、门店、员工、服务筛选；增加预约结果、门店/服务/商品销售、YoY、新客/留存/FOV、员工业绩/佣金及套餐余额价值报表。 | 完成后 Yes |
| Q4 Appointment Scheduling | 🟡 已上线 / 待申请截图 | 一对一美容预约日历、员工时间、房间/床位/设备、冲突与状态操作已进入生产（`61dbdf0`）。APT-01/APT-03 隔离 Free cloud UAT 已通过。申请截图后填 Yes。现有团课 Session 只保留，不作为证据。 | 申请截图后 Yes |
| Q5–Q6 Booking | 🟡 已上线 / 待申请截图 | 客户安全登录、实时档期、本人预约/取消、Package Credits 与订金已进入生产。申请截图与现场演示后填 Yes。 | 申请截图后 Yes |
| Q7 Customer Management | 🟡 已上线 / 待申请截图 | 客户身份、偏好、过敏、健康/禁忌、Treatment、Follow-up、Consent、敏感权限和审计已进入生产（含 CRM-01）。申请截图后填 Yes。 | 申请截图后 Yes |
| Q8 实时同步 | ✅ 基本满足 | 继续使用 Supabase 单一数据源；所有新模块写入同一套客户、预约、销售数据。准备两台设备同步修改和查看的演示。 | Yes |
| Q9–Q10 Loyalty | ⚪ 本次不做 | 不开发积分、兑换和会员等级；现有 Membership、Package 不描述成 Loyalty Programme。Q9 回答 No 后不会进入 Q10。 | Q9 No |
| Q11–Q12 Package | 🟡 已上线 / 待申请截图 | `PKG-01`/`PKG-02` 已进入生产：Salon Service/Location、opening-balance Ledger、人工调整申请和双人审批。部分 refund 与 Guest 发放仍不在范围。 | 申请截图后 Q11 Yes、Q12 Yes |
| Q13 收据和付款 | ✅ 基本满足 | 复用现有付款记录、编号、PDF Invoice 和退款；POS 完成后升级为多项目收据、退款收据/Credit Note，并显示门店、员工和付款方式。 | Yes |
| Q14 数字支付 | ✅ 基本满足 | 继续使用 HitPay；保留现金记录。申请材料只列出生产环境真实启用、可现场完成的 HitPay 支付方式。 | Yes |
| Q15 POS | 🟡 已上线 / 待申请截图 | in-house POS 已进入生产：客户、多服务/商品/套餐、员工、折扣、Cash/HitPay、收据、退款、作废、门店归属和日结。找零 UI 与 PDF 可点击收据仍不在本批。 | 申请截图后 Yes |
| Q16 SMS/E-Marketing | 🟡 已上线 / 待申请截图 | Email E-Marketing 已进入生产（`61dbdf0`）。Owner 已启用 Surgery 店 Email settings，受控测试邮件已通。SMS、WhatsApp 不做。 | 申请截图后 Yes |
| Q17 HR Management | 🟡 档案/跑批已上线 / 缺 Payslip | 员工主档、佣金、PAY-01 档案/规则和 PAY-02 四状态跑批已上线。还需 PAY-03 MOM Itemised Payslip 与报表。顾问签字不是硬前置。 | 完成后 Yes |
| Q18 IRAS AIS | ⚪ 本次不做 | 第一版不接 IRAS AIS，也不宣称属于 IRAS Supporting Payroll Software Vendor；已确认回答 No 不影响 Q17。 | No |
| Q19 Leave/Attendance/Roster | ⚪ 本次不做 | 预约使用的员工可用时间不描述成完整排班、考勤或请假系统。 | No |
| Q20–Q23 Inventory | ⚪ 建议不做 | 保留商品基础数量和 POS 扣减，但不申报完整 Inventory，避免额外开发仓库、库存流水、进出货、实时库存集成和低库存提醒。 | Q20 No；Q21–Q23 不触发 |
| Q24–Q25 Mobile App | ⚪ 建议不做 | 当前是响应式 Web/PWA，不宣称独立 Mobile App；如以后要回答 Yes，先取得 IMDA 书面确认并明确可申报模块。 | Q24 No；Q25 不触发 |
| Q26–Q27 AI | ⚪ 本次不做 | 不把自动计算、筛选、提醒或普通规则描述成 AI。 | Q26 No；Q27 不触发 |
| Q28 Business Data Extraction | 🟡 部分满足 | 当前主要只有付款 CSV；建立统一导出功能，让授权用户导出预约、客户、销售、套餐、佣金和工资等数据，支持 CSV、XLSX、XML 和 TSV。 | 完成后 Yes |
| Q29 Personal Data Protection | 🟡 有部分安全基础 | 补齐隐私告知和同意版本、访问/更正请求、资料保留、删除/匿名化、敏感权限、查看/导出审计和第三方处理者记录；由公司负责人/DPO 完成官方 PDPA Form。 | 完成产品控制和表格后 Yes |
| Q30 VA/PT | 🔴 缺合资格第三方报告 | 主要功能稳定后，聘请合资格独立第三方测试网络、Web、API、权限、数据保护、Cloud Configuration 和 OWASP Top 10；修复问题并取得复测/缓解证据。报告日期必须在提交前12个月内。 | 必须 Yes，否则不能提交 |
| Q31 Product Principal | 🟡 需公司确认 | 如果申请公司拥有并负责这套自研产品，选择 Product Principal；如果只是销售第三方产品，则走 Reseller 路径。 | 自研产品通常 Yes，但由公司正式确认 |
| Q32–Q33 Product Principal Cybersecurity Certification | 🔴 组织级事项 | Product Principal 规划 Cyber Essentials for ICT Vendors、Cyber Trust Mark、ISO 27001 或认可的等效认证；有证书才进入 Q33 上传证书、范围和日期。Annual Review 前要满足当期强制要求。 | 有有效证书才回答 Q32 Yes，否则按当期规则回答 No |
| Q34–Q35 Reseller Cybersecurity Certification | ⚪ 仅 Reseller 适用 | 只有 Q31 回答 No 才进入；Reseller 按要求准备自己公司的认可认证，有证书才进入 Q35 上传材料。 | 取决于 Q31 和实际证书 |

## 总体结论

### 当前基本可以直接使用

- Q1 云端/多设备
- Q8 实时同步
- Q13 收据和付款记录
- Q14 HitPay 数字支付

这些项目仍然需要准备正式环境截图、操作记录和现场演示，不能只提供代码说明。

### 必须完成开发或验收收口后才能回答 Yes

- Q2 多门店
- Q3 Dashboard/Reports
- Q4 Appointment
- Q5–Q6 Booking
- Q7 Customer Management
- Q11–Q12 Package
- Q15 POS
- Q16 Marketing
- Q17 HR/Payroll
- Q28 Data Extraction
- Q29 PDPA 产品控制

### 本次计划回答 No

- Q9 Loyalty
- Q18 IRAS AIS
- Q19 Leave/Attendance/Roster
- Q20 Inventory
- Q24 Mobile App
- Q26 AI

回答 No 后，对应的 Q10、Q21–Q23、Q25 和 Q27 不会触发。

### 最大的外部风险

1. Q16/Q17：范围已经确认，但必须保存完整回复证据并确保报价、合同和演示一致。
2. Q17：法定计算须与 CPF Board 现行规则及 MOM Payslip 字段逐项验证；顾问复核为可选项，不是开发或申报硬前置。
3. Q29：必须由公司负责人/DPO 完成官方 PDPA Form。
4. Q30：必须由合资格独立第三方提供有效 VA/PT 报告。
5. Q31–Q35：必须确认 Product Principal/Reseller 身份，并规划组织级网络安全认证。

## 开发和申请的最简顺序

1. 先归档 Q16/Q17 回复证据，并确认 Product Principal 身份、VA/PT 报价和认证路径。
2. 开发员工、客户、门店和审计基础。
3. 收口 Appointment、Customer 并完成预约通知。
4. 先开发 POS Sale/Cart，再并行升级 Package Ledger、Cash/HitPay 和客户自助 Booking。
5. 开发 Commission、Refund/Close、Marketing、Payroll。
6. 最后开发 Dashboard 和多格式数据导出。
7. 完成 PDPA 表格及证据、安全加固、第三方 VA/PT、演示数据和申请截图。

技术团队不要直接从本表开发，应从 [统一开发约定](./00-development-guide.md) 和 [开发任务清单](./10-development-backlog.md) 领取单个任务。

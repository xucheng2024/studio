# 6. 营销推广系统

新增一个最小但可以完整演示的 Email Campaign 模块，提供客户分组、富文本内容、立即或预约发送、送达及点击报告和客户退订。

已取得回复确认 Q16 的 SMS / E-Marketing 是 **OR**。因此 PSG Core Edition 只实现完整 Email E-Marketing，复用 Resend；SMS、MMS 和 WhatsApp Campaign 均不进入本次报价、开发、测试或演示。现有网站 Click-to-Chat 可以继续作为非 Campaign 附加功能保留。

## 6.1 结合现有代码的改造原则

现有代码可以复用：

- `salon_customers` 和客户消费、预约、疗程记录：用于筛选 VIP、常客和长期未到店客户。
- `salon_customer_consents`：使用第 3 节设计的 Email Marketing 同意记录，在发送前检查。
- `src/lib/email.ts` 和现有 Resend 配置：继续作为 Email 发送基础。
- `locations` 和员工门店权限：用于限定可以查看和选择的客户范围。
- 现有网站、服务、套餐及 Appointment 页面：作为 Campaign 预约按钮的目标页面。
- 现有 Vercel Cron 模式：增加预约 Campaign 的分批发送任务。
- `operation_audits`：记录 Campaign 创建、修改、发送、取消和导出操作。

当前代码需要解决的缺口：

- 现有 Email 只发送预约、付款和发票等单封事务邮件，没有 Campaign 或客户分组。
- `sendEmail` 没有保存 Resend Message ID，也没有将 delivered、bounced、complained 和 clicked Webhook 写回数据库，不能生成成功率报告。
- 现有 Email 失败会被直接跳过，适合事务通知，但不能作为可重试、可审计的群发引擎直接使用。
- 目前没有 Campaign 内容、收件人快照、预约发送、退订名单和点击追踪。
- 当前 WhatsApp 功能只是公开网站上的 Click-to-Chat 链接，不属于本次 Campaign。

因此，应在现有 Email 基础上新建 Campaign 发送层，不直接循环调用当前事务邮件方法，也不能把公开网站的 WhatsApp 按钮当作营销系统。

## 6.2 PSG 渠道选择结论

已取得的回复为：Q16 是 OR，完整 E-Marketing 可以在没有 SMS 的情况下满足本题。因此本次范围固定为 Email-only：Resend 发送、客户分组、标题/文字/图片、预约或套餐 CTA、立即/预约发送、成功率、点击率和退订。

申请材料应保存回复截图、回复人身份、日期及上下文，并确保报价、合同和演示均不把 SMS 或 WhatsApp 写入 PSG Core Edition。若 Vendor Management Portal 后续修改题目，应以提交时最新版本重新核对。

## 6.3 客户分组

新增 `/dashboard/marketing/audiences`，最小提供三个系统分组：

- **VIP**：指定统计期间内，已付款净消费达到商户设置金额，或被 Owner 手工标记为 VIP。
- **Frequent Customer / 常客**：指定期间内完成服务次数达到商户设置次数。
- **Inactive Customer / 长期未到店**：最后一次完成服务距离当前日期超过商户设置天数，例如 90 天。

筛选统一支持：

- 日期范围
- 门店
- 服务
- 服务员工
- Email Marketing 有效同意

规则要求：

- VIP 金额使用 Paid 减 Refund 后的净消费，不能计算 Pending 或 Voided 销售。
- 常客按完成的 Appointment / Treatment 次数计算，同一次服务不能重复计数。
- 长期未到店以最后一次 Completed 服务日期计算，没有完成记录的新客户不自动归入长期未到店。
- 门店筛选按客户实际消费或服务门店计算，不能只使用客户建档门店。
- 列表显示预计人数、有效同意人数、无联系方式人数和已退订人数。
- 健康状况、过敏、禁忌和疗程备注绝对不能作为普通营销分组条件或导出内容。

创建 Campaign 时保存收件人快照。之后客户消费变化不会改变这次历史名单，但真正发送前仍必须再次检查最新 Consent 和 Suppression 状态。

## 6.4 Campaign 内容编辑器

新增 `/dashboard/marketing/campaigns/new`，第一版只提供固定模块式编辑器，不开发复杂拖拽设计器。

共同内容：

- Campaign 名称
- 目标客户分组
- 主标题
- 正文
- 一张图片
- 按钮文字
- 按钮目标：在线预约、服务页面、套餐页面或经过验证的自定义 HTTPS 链接
- 发送门店和品牌名称

- Email Subject
- 标题、段落、图片和一个主要 CTA Button
- 自动加入商户资料和 Unsubscribe 链接
- Desktop 和 Mobile 预览

所有用户输入的 HTML 必须由系统模板生成或经过严格清理，不能允许员工直接输入任意 Script、Iframe 或不安全 HTML。

## 6.5 草稿、测试和发送流程

Campaign 状态：

- `draft`：正在编辑。
- `scheduled`：已预约发送。
- `sending`：系统正在分批发送。
- `completed`：全部有效收件人已处理。
- `cancelled`：发送前取消。
- `failed`：系统级错误导致任务停止，可由 Owner 重试。

发送流程：

1. 选择分组并预览预计客户数量。
2. 向指定测试 Email 发送测试内容。
3. 选择立即发送，或按 Asia/Singapore 时间预约发送。
4. 发送前生成收件人快照，并再次排除无有效同意、已退订、无联系方式和受抑制客户。
5. 后台任务分批锁定待发送记录并调用 Resend。
6. 保存服务商 Message ID、提交结果和尝试次数。
7. Webhook 更新 Delivered、Failed、Bounced 或其他状态。
8. 达到最大重试次数后停止自动重试，并在报告中显示原因。

现有 Vercel Cron 仅处理过期 Payment。新增 `/api/cron/dispatch-campaigns`，每分钟或每五分钟取得到期 Campaign，并以小批量发送，避免一次群发超过 Serverless 执行时间。数据库必须使用锁定和幂等键，Cron 重复运行不能重复发送同一收件人。

## 6.6 Email：继续使用 Resend

保留 `RESEND_API_KEY` 和已验证 From Domain，但新增独立 `CampaignEmailProvider`：

- 批量发送时保存 Resend Email ID。
- 使用 Resend Batch API 分批提交，不把全部客户放在同一个 To / CC / BCC 中。
- 每位客户获得独立邮件和独立退订、点击 Token，不能暴露其他客户地址。
- 新增带签名验证的 `/api/webhooks/resend`。
- 接收 Sent、Delivered、Bounced、Complained、Failed 和 Clicked 等事件。
- Hard Bounce 或 Complaint 自动加入 Email Suppression List。
- 发送失败按明确规则重试，配置错误或永久失败不无限重试。

现有预约、付款和发票邮件继续使用事务邮件流程，不受客户 Marketing 退订影响；营销 Campaign 必须走新的 Consent 和 Suppression 检查。

## 6.7 本次明确不做的渠道

- 不接 SMS Provider，不开发 SMS 群发、Sender ID、额度、计费或 SMS Webhook。
- 不使用 Supabase Auth SMS；它只服务登录 OTP，也不属于 Email E-Marketing。
- 不开发 WhatsApp Business Platform 或自动群发；现有 `wa.me` Click-to-Chat 继续作为非资助附加功能。

以后如单独销售 SMS 或 WhatsApp Add-on，应重新设计独立 Consent、Provider、Webhook、退订、费用和合规流程，不复用 Email Consent，也不混入本次 PSG 报价。

## 6.8 同意、退订和新加坡合规

本次只处理 Email Marketing：

- Marketing Consent 保存 Granted / Withdrawn、渠道、时间、来源、同意文字版本和证据。
- 创建名单和真正发送前都实时检查 Consent。
- Email 的每封营销邮件包含一键 Unsubscribe 链接。
- 客户退订后立即加入相应渠道 Suppression List；系统无需等待 21 天才停止。
- 一个渠道的同意不能推定另一个渠道也同意。
- 客户仍可收到已购买服务所必需的预约确认、提醒和付款收据，但这些事务通知不能夹带营销内容。

正式上线前，应由新加坡数据保护负责人或法律顾问确认实际同意文案、PDPA 直接营销要求和退订流程；系统负责提供可执行控制和证据记录。

## 6.9 点击追踪和 Campaign 报告

每个收件人的预约按钮使用独立签名链接，例如 `/r/c/{token}`。服务器先记录点击，再重定向到安全的预约、服务或套餐 HTTPS 页面。

报告至少显示：

- 目标客户人数
- 因没有 Consent、退订、无联系方式或 Suppression 被排除的人数
- Attempted、Submitted、Delivered、Failed 和 Bounced 数量
- 发送成功率：Delivered ÷ Attempted
- 独立点击人数
- 点击率：Unique Clicked ÷ Delivered
- 退订人数和退订率
- 按渠道、Campaign、日期和门店筛选

Email Open Rate 可以作为辅助数据，但不能作为核心成功标准，因为隐私保护和图片代理会造成不准确。申请演示以 Delivered、Failed 和 Unique Click Through Rate 为主。

点击 Token 不能包含客户 Email、电话或可读个人资料。系统只允许重定向到白名单内的本平台网址或经过服务器验证的 HTTPS 域名，避免被用作开放跳转攻击。

## 6.10 数据结构建议

新增：

- `marketing_campaigns`：Campaign 名称、渠道、状态、分组规则快照、内容版本、预约时间、门店和创建人。
- `marketing_campaign_recipients`：客户、联系方式快照、Consent 校验结果、发送状态、服务商 Message ID 和重试次数。
- `marketing_campaign_events`：Submitted、Delivered、Failed、Bounced、Complained、Clicked 和 Unsubscribed 事件。
- `marketing_links`：原始目标、签名 Token、Campaign 和点击统计。
- `marketing_suppressions`：按 Studio、客户、联系方式和渠道保存退订、Bounce、Complaint 或管理员阻止原因。
- `marketing_provider_settings`：每个 Studio 的 Resend Email 配置状态；密钥只保存服务器端 Secret，不写入普通表或浏览器。

收件人和事件属于历史业务证据，Campaign 完成后不能因客户资料更新而覆盖。删除客户请求需要按数据保留政策进行匿名化或删除处理，同时保留必要的财务和合规记录。

## 6.11 页面、权限和接口

新增页面：

- `/dashboard/marketing`：Campaign 列表和整体统计。
- `/dashboard/marketing/audiences`：VIP、常客和长期未到店预览。
- `/dashboard/marketing/campaigns/new`：内容编辑、预览、测试和发送。
- `/dashboard/marketing/campaigns/[campaignId]`：收件人、发送结果、点击和退订报告。
- `/dashboard/marketing/suppressions`：退订及失败地址管理。

新增接口：

- `/api/marketing/campaigns`：建立、修改和读取 Draft。
- `/api/marketing/campaigns/[id]/test`：发送测试内容。
- `/api/marketing/campaigns/[id]/schedule`：确认名单和立即/预约发送。
- `/api/cron/dispatch-campaigns`：分批发送到期 Campaign。
- `/api/webhooks/resend`：接收并验证 Resend 事件。
- `/api/marketing/unsubscribe`：处理带签名 Token 的退订。
- `/r/c/[token]`：记录点击并安全重定向。

权限：

- Owner：管理渠道配置、查看所有门店、发送 Campaign 和导出报告。
- Manager：只对授权门店建立和发送 Campaign。
- Frontdesk：可以查看客户营销状态，但默认不能群发或导出完整名单。
- 普通服务员工：默认不能进入 Marketing 模块。

所有发送、取消、导出、手工恢复 Suppression 和渠道配置修改都写入 Audit。客户健康资料永远不进入 Campaign 页面、模板变量或营销导出。

## 6.12 最小版本不做的功能

为了控制范围，第一版不做：

- AI 自动写营销内容
- A/B Test
- 多步骤自动营销 Journey
- 根据客户行为实时自动触发 Campaign
- MMS 图片短信
- SMS Campaign、额度和计费
- WhatsApp 自动群发
- 自建短网址域名管理
- 跨 Studio 共享客户或 Campaign

这些不是已确认 Q16 Email E-Marketing 路径的范围。第一版只把 Email、三个客户分组、预约发送、CTA 点击、成功率和退订做完整。

## 6.13 测试和过审验收

提交前至少验证：

- VIP、常客和长期未到店三种名单计算正确。
- 退款后的净消费会影响 VIP 筛选。
- Email 只发送给有有效 Email Marketing Consent 的客户。
- 客户在预约发送后、实际发送前退订时不会收到信息。
- Email 可以显示标题、文字、图片和预约按钮。
- 立即发送和 Asia/Singapore 预约发送均正常。
- 重复 Cron 不会向同一 Campaign Recipient 重复发送。
- Resend Webhook 签名无效时不会更新报告。
- Delivered、Failed、Bounced、Unique Clicked 和 Unsubscribed 报表正确。
- 点击链接不会泄露客户资料，也不能重定向到未授权网站。
- Manager 不能查看或营销其他门店客户。
- Frontdesk 和普通员工不能绕过 API 权限群发或导出名单。
- 健康、过敏和疗程备注不会出现在筛选、模板或导出中。

正式技术演示流程：建立 VIP、常客和 90 天未到店客户 → 分别展示预计人数和有效 Email 同意人数 → 建立含标题、图片、文字和预约按钮的 Email Campaign → 预约发送 → 展示 Delivered、Failed 和 Click Through Rate → 客户点击退订 → 再次建立 Campaign 并证明该客户已被自动排除。

## 6.14 官方依据和当前判断

- [IMDA Salon Management System Q16](https://preapproval-guide.imda.gov.sg/pre-approval-guide/stage-1-vendor-self-assessment/identify-suitable-solution-category/personal-care-services/salon-management-system)：Q16 为 Mandatory；本项目已另行取得 “SMS or E-Marketing” 为 OR 的回复，并按完整 Email E-Marketing 实现。
- [Resend Webhook Event Types](https://resend.com/docs/webhooks/event-types)：用于取得 Delivered、Bounced、Failed 和 Clicked 等 Campaign 事件。

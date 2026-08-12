# CRM-02 Playwright 测试账号与复跑说明

本说明记录 CRM-02 生产浏览器验收使用的固定测试账号、数据范围和复跑方法。账号 ID、邮箱及业务数据 ID 的唯一来源是 [`crm02-playwright-accounts.json`](./crm02-playwright-accounts.json)。该文件只允许保存非敏感 fixture，不得写入密码、Supabase key、magic link 或 session token。

## 测试范围

固定测试 Studio 为 `CRM02 PW crm02pw_1786517551113`，包含 L1、L2 两个 Location。账号均使用不可投递的 `example.com` 邮箱，通过 Supabase Admin API 生成一次性 magic link 登录，不依赖收件箱。

| Fixture key | 邮箱后缀 | 权限场景 |
| --- | --- | --- |
| `owner` | `.owner@example.com` | Studio Owner，全门店 |
| `managerGlobal` | `.manager.global@example.com` | Global Manager，全门店 |
| `managerL1` | `.manager.l1@example.com` | Location Manager，仅 L1 |
| `frontdeskL1` | `.frontdesk.l1@example.com` | Frontdesk，仅 L1 |
| `instructorL1` | `.instructor.l1@example.com` | Instructor，L1 实际服务关系 |
| `instructorL2` | `.instructor.l2@example.com` | Instructor，L2 实际服务关系 |
| `mixed` | `.mixed@example.com` | L1 Manager + L2 Instructor 混合角色 |

完整邮箱和 UUID 请直接查看 fixture JSON，避免在多处维护后产生偏差。

## 环境配置

在本地 `.env.local` 配置以下变量：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

fixture 固定绑定 Supabase project ref `yjupnmbrpqeuyxgrpsrb`。脚本会在写数据前校验 project ref，不匹配时立即退出。

通常不需要 `CRM02_TEST_PASSWORD`。只有测试 Auth 用户被删除、需要脚本重新创建时，才临时在本机环境中提供：

```bash
CRM02_TEST_PASSWORD='local-secret' npm run test:crm02-browser
```

不要把该密码提交到仓库或测试报告。

## 运行方法

生产环境完整验收：

```bash
npm run test:crm02-browser
```

指定其他部署或 localhost：

```bash
CRM02_BASE_URL='https://deployment.example.com' npm run test:crm02-browser
```

脚本会自动 upsert 固定 fixture、为每个角色生成一次性登录链接，并验证：

- Owner、Global Manager、Location Manager、Frontdesk、Instructor 和混合角色的客户列表、详情及 Follow-up queue；
- Instructor 仅按 `actual_employee_id` 实际服务关系授权；
- 390px 移动端无横向溢出；
- 未完成预约阻断、幂等重放、审计正文脱敏和 Follow-up queue 数据。

成功时进程退出码为 `0`，报告和截图位于 `tmp/crm02-playwright/`。该目录不提交 Git，报告不得包含 access token、refresh token 或完整 magic link。

## 保留与维护规则

- 这些账号和 fixture 专用于自动验收，可以长期保留并重复使用，不得用于真实业务。
- 脚本采用固定 UUID 和 upsert，可重复执行；每次执行使用新的 `executionId` 保存报告和 DB 断言证据。
- CRM-02 Revision、Follow-up History 和强审计记录是 append-only，不应通过关闭触发器或绕过约束强制清除。
- 如果误删角色关系，直接重跑脚本即可恢复；如果 Auth 用户也被删除，则按上文临时提供 `CRM02_TEST_PASSWORD` 后重跑。
- 修改账号、Location 或业务对象 ID 时，只修改 fixture JSON，并同步检查脚本的权限预期。

## 最近一次基线

2026-08-12 在 `https://www.sgmystudio.com` 验收通过：7/7 浏览器角色检查、4/4 DB 断言，以及人工业务流和移动端验收。

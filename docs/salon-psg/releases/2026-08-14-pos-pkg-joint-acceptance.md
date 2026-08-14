# 2026-08-14 POS / Package 联合发布门禁与目标环境验收

## 结论

- 本地发布门禁已恢复：ESLint、TypeScript、Next.js production build 通过。
- POS-02、POS-03、POS-04、PKG-01、PKG-02 的隔离 PostgreSQL 事务验证通过。
- 目标 Supabase migration 已与本地对齐至 `20260814009000`。
- 目标环境发现并修复 PKG-01 历史 opening balance 缺口：2 条正余额客户套餐已写入 2 条 append-only Ledger，无冲突，复核通过。
- 目标浏览器角色矩阵与 390px 回归通过。
- `e3c0932` 已推送并由 Vercel Git Integration 部署至 Production；部署后 smoke、目标预检和浏览器矩阵再次通过。
- 真实 HitPay Sandbox 支付仍阻塞：隔离 UAT Studio 未启用 HitPay，且没有 merchant API key / webhook salt；不得借用真实商户生产配置制造测试支付。
- POS-04 最终 Gate 仍依赖 COM-01 的佣金反向 Entry。

## 代码门禁

执行结果：

- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。曾与 `next build` 并行执行时因 `.next/types` 同时生成出现临时 `routes.js` 缺失；构建完成后串行重跑通过，因此后续门禁固定串行执行。
- `npm run build`：通过，Next.js `16.2.4` production build 完成 131 个静态页面生成。
- Cash Session 页面不再于 render 中调用 `Date.now()`；idempotency nonce 改用仓库现有的 `crypto.randomUUID()` 服务端表单模式。

## 本地数据库联合验证

以下命令均在独立 PostgreSQL 15 容器通过：

- `npm run test:pos02-db`：Cash complete、付款/销售状态和幂等通过。
- `npm run test:pos03-db`：HitPay webhook complete 与重放幂等通过。
- `npm run test:pos04-db`：部分退款、开班、现金归集、关班和重放幂等通过。
- `npm run test:pkg01-db`：Paid 发放、退款回冲、opening balance、deferred value 通过。
- `npm run test:pkg02-db`：部分退款回冲、Guest 延迟发放、maker-checker 与导出契约通过。

五个 runner 已统一等待 PostgreSQL 初始化临时实例退出并确认最终实例就绪，关闭连续执行时偶发的 `server closed the connection unexpectedly`。

## 目标 Supabase 验收

### Migration

`supabase migration list --linked` 显示 POS/PKG migration 本地与远端全部对齐，包括：

- POS-01/02/03/04：`20260813001000` 至 `20260813200000`。
- PKG-01/02：`20260814001000` 至 `20260814009000`。

### PKG-01 opening balance

只读预检最初发现：

- `client_packages = 2`
- `client_package_ledger_entries = 0`
- 2 条正余额套餐缺少 Ledger；两条均可唯一映射 Salon Customer，无缺失或多重映射。

随后执行：

1. `npm run backfill:pkg01-opening`：dry-run 返回 `scanned=2`、`inserted=2`、`conflicts=0`。
2. `npm run backfill:pkg01-opening -- --apply`：实际写入 2 条 `opening_balance` Ledger，`conflicts=0`。
3. `npm run verify:pos-pkg-target`：返回 `ok=true`；Ledger 共 2 条，正余额缺 Ledger、未解决 conflict、自审批、已应用无 Ledger、Guest 失败/积压均为 0。

回填 RPC 使用来源唯一键且可重放；历史余额 Ledger 为 append-only，可通过强审计追踪。

## 目标浏览器角色与移动端

`npm run verify:pos-pkg-browser` 使用仓库隔离 UAT 账号和一次性 Magic Link，只读访问正式域名，没有创建销售、付款、退款或审批。

| 角色 | POS | Cash Session | Package Approval | 结果 |
|---|---|---|---|---|
| Owner | 允许 | 允许 | 允许 | 通过 |
| Global Manager | 允许 | 允许 | 允许 | 通过 |
| Location Manager | 授权门店允许 | 授权门店允许 | 授权门店允许 | 通过 |
| Frontdesk | 授权门店允许 | 授权门店允许 | 授权门店允许 | 通过 |
| Instructor | 拒绝 | 拒绝 | 拒绝 | 通过 |

Owner 在 390px 下访问 POS、Cash Session、Package Approval，均无页面级横向溢出。

## 尚未关闭的 Gate

1. HitPay Sandbox：需要为隔离 UAT Studio 配置专用 Sandbox merchant API key、webhook salt，并启用 HitPay；之后完成创建 Payment Request、成功回调、签名失败、重复 webhook、主动同步和失败恢复。
2. 事务浏览器 UAT：当前目标环境是 Production。本轮没有为了测试而写入销售、Cash Session、退款或审批记录；应使用独立 Staging/UAT Project 或经业务批准的专用 Production fixture 执行点击流。
3. COM-01：佣金原始 Entry 与退款反向 Entry 未实现，POS-04 不得升为最终完成。
4. 本轮 Cash Session lint 修复、runner 和验收脚本已随 `e3c0932` 部署，部署后 Gate 已关闭。

## 部署后复核

- Git：`e3c0932 test(pos): restore POS package release gates` 已推送至 `origin/main`。
- Vercel：Production deployment `dpl_F6UeLQpKUCQA7NATcqtvjasZAFdS`，状态 `READY`；构建日志明确记录 `Branch: main, Commit: e3c0932`。
- 正式域名：`https://www.sgmystudio.com`。
- Route smoke：主页、POS、Cash Session、Package Approval、Reports、Operations 均返回 `200`；未携带 Cron Secret 请求 PKG-02 Cron 返回预期 `401`。
- `npm run verify:pos-pkg-target`：`ok=true`，无 failure/warning，opening Ledger 仍为 2 条且无缺口或冲突。
- `supabase migration list --linked`：本地/远端继续对齐。
- `npm run verify:pos-pkg-browser`：Owner、Global Manager、Location Manager、Frontdesk 允许；Instructor 拒绝；Owner 390px 回归全部通过。

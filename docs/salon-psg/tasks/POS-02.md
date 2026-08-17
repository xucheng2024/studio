# POS-02：现金收款闭环（Batch 1 + Batch 2）

状态：已实现/待专用本地 UAT 执行（Batch 1/2 已落地）

负责人：Codex

开始日期：2026-08-13

Commit / Release：`0d66116`、`05d877d`；未上线

## 1. 目标

打通 `pending_payment` POS 单的最小现金收款闭环：

- 通过一次受权的“现金已收”动作把 `pos_sales.status` 从 `pending_payment` 推进到 `paid`
- 同事务回写 `payments.status` 从 `pending` 到 `paid`
- 引入幂等栅栏，保证重复提交不重复入账
- 写入强审计，支持后续收据/日结依赖

## 2. 本批范围（Batch 1）

- 数据库事务 RPC：`complete_pos_cash_sale`
- Dashboard Server Action：`completePosCashSaleAction`
- POS 明细页 + Payments 列表按钮入口：`Mark as paid (cash)`
- 读模型最小字段：展示现金收款时间与操作人（邮箱或用户 ID）
- DB 验证脚本：成功路径、同 key 重放幂等、越权拒绝

## 2.1 Batch 2（已落地）

- 现金确认时生成并落库 `receipt_number`
- Payments 增加快捷筛选：`Pending POS Cash (7d)`

## 3. 本批不做

- 找零计算 UI / 钱箱班次 / 正式收据号段
- 退款/作废完整闭环（POS-04）
- HitPay 在线支付链路（POS-03）

## 4. 验收标准（Batch 1）

- `pending_payment` POS 单可一键改为现金 `paid`
- 同 idempotency key 重放不重复写入、不重复审计
- 非授权角色或跨门店/跨工作室请求被拒绝
- `npm run test:pos02-db` 与 `npx tsc --noEmit` 通过

## 5. 本地浏览器 UAT

- 专用 flow：`pos02-cash-receipt-local`（`uat.flows.json`）。
- 首选执行：GitHub Actions **Free cloud UAT**，选择 `pos02-cash-receipt-local`（runner 自带 Docker 并启动本地 Supabase）。
- 本机有 Docker 时也可经 `$uat-browser` 的 `run_flow.py` 跑同一 flow；本机缺 Docker 时不要当作任务失败，改走 Free cloud UAT。
- 覆盖：390px 现金班次开启、现金收款、`pos_sales`/`payments` 原子 paid 结果、receipt number 页面展示，以及 Instructor POS 拒绝访问。
- 不把找零或 PDF/可点击收据作为本项通过条件：当前 POS-02 UI 和任务范围均未实现这些能力。

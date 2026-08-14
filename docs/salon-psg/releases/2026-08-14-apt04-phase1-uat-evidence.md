# APT-04 Phase 1 UAT Evidence

- RUN_ID: `APT04-UAT-LOCAL-20260814-2350`
- Environment: local isolated Supabase (`127.0.0.1`) + local Next.js
- Production writes: none
- Evidence: `tmp/apt04-uat/APT04-UAT-LOCAL-20260814-2350/`（`index.json` + 16 张截图）

## 已通过

- Google Chrome `151.0.7922.138`：登录拦截、档期/T&C、创建、改期、取消、反馈、stale T&C、跨 Studio、本人预约页完整链路。
- Firefox `153.0`、WebKit `26.5`：档期/T&C、创建、取消关键链路。
- Chrome 390x844 viewport：预约页和本人预约页无 body 横向溢出。
- `test:apt04-db` / APT-02 DB gates：本人权限、幂等和并发约束。

## UAT 发现并修复

1. 对齐真实 schema：`studio_services.title` 与 `employees.employment_status`。
2. 创建预约改用每次表单渲染生成的幂等 key，允许取消后重新预订同一时段。
3. `/me/appointments` 仅在用户确实绑定 active Studio 时重定向。
4. 移除会员 tabs 根级负边距，修复 390px 横向溢出。

## 已接受的剩余风险

- 真实 Safari：本机 Safari 未开启 Developer → **Allow remote automation**；WebKit 结果不冒充真实 Safari。
- 真实 390px 设备/系统模拟器：本机没有可用 iOS Simulator；390x844 viewport 仅作为预检。
- 业务方于 2026-08-14 明确决定不继续执行上述两项，并接受其为非阻断剩余风险。

结论：代码与隔离 UAT 通过，APT-04 Phase 1 标记为“可验收”；该结论不等同于“已上线”。

# 2026-08-14 APT-04 Phase 1 浏览器验收清单与证据模板

> 适用范围：APT-04 Phase 1（登录客户自助预约）。
>
> 目标：在不引入第二阶段支付/Package 的前提下，补齐 390px + 多浏览器 + 权限/隔离/幂等/并发冲突的可追溯验收证据。

## 0. 环境与数据保护（必须先确认）

- 仅允许在隔离环境执行写入验收（本机 Docker Supabase / 独立 UAT）。
- 禁止在 Production 共库创建测试预约、客户、支付、条款接受等测试数据。
- 若需要展示生产行为，仅可做只读核验与历史数据抽样，不得发起 create/reschedule/cancel。

执行前声明（建议）：

```bash
test "${APT04_ENV_CLASSIFICATION:-}" = "uat" || {
  echo "blocked: APT-04 browser write acceptance requires isolated UAT" >&2
  exit 1
}
```

## 1. 验收范围（Phase 1）

- 登录客户自助预约（`/{studioSlug}/appointments`）。
- 实时可用档期展示与提交时二次冲突校验。
- 本人预约查看（`/{studioSlug}/me/appointments` + `/me/appointments`）。
- 本人改期与取消。
- T&C 展示、接受与版本一致性（提交时 stale 检查）。

不在本轮范围：

- Package 扣减。
- 订金/全款支付闭环。
- 匿名 Guest 自助预约。

## 2. 执行准备

- `RUN_ID`：`APT04-UAT-YYYYMMDD-HHMM`。
- 浏览器：`Chrome`、`Safari`（或 `Edge`）。
- 设备：桌面（>=1280）+ 移动端 390px（DevTools Device 模拟可接受）。
- 账号：
  - Customer-A（Studio-S1 绑定客户）
  - Customer-B（Studio-S2 绑定客户）
  - Customer-C（无绑定或跨 Studio）
- 门店：至少 2 个 Studio（S1/S2），每个至少 1 个 Location。

## 3. 浏览器验收清单（可直接勾选）

> 每个场景需保留：操作前后截图 + URL + 关键文案 + 结果判定。

### 3.1 登录与入口

- [ ] 未登录访问 `/{studioSlug}/appointments` 被重定向到 studio auth，登录后回跳正确。
- [ ] 已登录 Customer-A 可访问 S1 预约页。
- [ ] `/me/appointments` 在无 studio 上下文时可展示跨 Studio 预约聚合，或重定向到 active studio。

### 3.2 实时档期与创建

- [ ] 选择 Location/Service/Date 后可加载档期。
- [ ] 提交缺字段时出现明确错误提示。
- [ ] 同一时段并发占用后，提交返回冲突提示（`slot_conflict`/`resource_conflict`），页面可继续重试。
- [ ] 档期边界不出现“提交必失败”的开门首档/关门末档（prep+buffer 已计入）。

### 3.3 本人预约查看/改期/取消

- [ ] `/{studioSlug}/me/appointments` 能看到本人预约。
- [ ] 改期成功后显示 `ok` 提示并刷新结果。
- [ ] 取消成功后显示 `ok` 提示并刷新结果。
- [ ] 失败场景显示 `error` 提示（不应仅“原地刷新”）。

### 3.4 权限与隔离

- [ ] Customer-A 不能操作 Customer-B 预约（直接改 hidden appointment_id 或跨账号页面重放）。
- [ ] Customer-A 不能跨 Studio 操作 S2 预约。
- [ ] `/me/appointments` 聚合列表不会泄露他人数据。

### 3.5 幂等与并发

- [ ] 重复提交同请求不会创建重复预约。
- [ ] 一次失败（冲突）后再次提交可恢复，不会长时间卡在 `idempotency_in_progress`。
- [ ] 改期失败后换新时间可提交（key 含新时间，不触发 hash conflict）。

### 3.6 T&C 展示与版本一致性

- [ ] 页面展示当前 T&C 内容快照（非仅版本号）。
- [ ] 未勾选 T&C 不可提交。
- [ ] 页面打开后若条款版本更新，再提交会被拒绝并提示重新阅读（`terms_version_stale`）。

### 3.7 多浏览器 + 390px

- [ ] Chrome 桌面全链路通过（创建/查看/改期/取消）。
- [ ] Safari/Edge 桌面全链路通过。
- [ ] 390px 下预约页、我的预约页可操作，无关键按钮遮挡/溢出。

## 4. 证据目录规范

```bash
mkdir -p "tmp/apt04-uat/${RUN_ID}/screenshots"
```

建议截图命名：

- `01-login-redirect.png`
- `02-booking-slots-loaded.png`
- `03-booking-slot-conflict.png`
- `04-booking-success.png`
- `05-me-appointments-list.png`
- `06-reschedule-success.png`
- `07-cancel-success.png`
- `08-scope-forbidden.png`
- `09-idempotency-retry-recovered.png`
- `10-terms-stale-rejected.png`
- `11-chrome-390-booking.png`
- `12-safari-390-me-appointments.png`

## 5. 证据模板（直接复制填写）

```md
# APT-04 Phase 1 UAT Evidence

- RUN_ID:
- Environment: (Docker Supabase / Isolated UAT)
- Date:
- Executor:
- Browsers: (Chrome xx, Safari/Edge xx)

## A. Scope Confirmation

- [ ] Phase 1 only (no package/deposit/full-payment)
- [ ] No production write test data

## B. Scenario Results

| ID | Scenario | Browser | Device | Result | Screenshot | Notes |
|---|---|---|---|---|---|---|
| B01 | Login redirect + return |  | Desktop |  |  |  |
| B02 | Slot load |  | Desktop |  |  |  |
| B03 | Slot conflict handling |  | Desktop |  |  |  |
| B04 | Book success |  | Desktop |  |  |  |
| B05 | My appointments list |  | Desktop |  |  |  |
| B06 | Reschedule success + feedback |  | Desktop |  |  |  |
| B07 | Cancel success + feedback |  | Desktop |  |  |  |
| B08 | Cross-studio/identity forbidden |  | Desktop |  |  |  |
| B09 | Idempotency retry recovered |  | Desktop |  |  |  |
| B10 | Terms stale rejected |  | Desktop |  |  |  |
| B11 | Booking @390px |  | 390px |  |  |  |
| B12 | My appointments @390px |  | 390px |  |  |  |

## C. Gate Verdict

- [ ] 权限通过（本人/跨 Studio 隔离）
- [ ] 幂等通过（失败释放 + 可恢复重试）
- [ ] 并发冲突提示通过
- [ ] T&C 展示与 stale 版本拒绝通过
- [ ] 390px 与多浏览器通过

结论：
- [ ] 可验收（Phase 1）
- [ ] 不可验收（需修复后复测）

## D. Attachments

- Screenshot folder:
- Related logs/queries:
- Optional video:
```

## 6. 建议执行顺序

1. 先桌面 Chrome 跑全链路。
2. 再第二浏览器复跑关键 Gate（B03/B06/B08/B10）。
3. 最后切 390px 跑 B11/B12。
4. 汇总模板并给出“可验收/不可验收”结论。


# Native cutover gate evidence — 2026-08-25

采集时间：`2026-08-25T03:40:17Z`
代码版本：`89755449810895d54899c25c2300419c9787a08b`

## 结论

门禁保持关闭，不进入完整兼容校验、native preflight 或维护窗口切换。本次检查只有本地只读操作，外部写入为 0。

## Shadow 严格审计

审计输入：`var/handoff/139a5aab86f473df6b62/state.json`

- 结构与血缘有效：`valid=true`，blocker 0；
- 173 条决策、79 个 matter、23 个任务快照、3 条反馈；
- 170 条完整 source/context、3 条 durable receipt、0 条无来源决策；
- 19 条差异、43 次任务变更；
- 窗口截止 `2026-08-27T11:52:20.935Z`，当前 `windowComplete=false`、`readyForEvaluation=false`；
- 唯一 warning：`shadow-window-in-progress`。

## Dida projection 严格审计

旧路径 `/Users/edy/BlackLakeWork/codex-lark-bridge/var/state.json` 已不存在；审计没有猜测旧位置，而是使用自包含
handoff 中的 `state.json` 与 `dida/**/result.json`：

- 255 个 result 文件，其中 152 个 task projection；
- 132 个 current-schema 严格接受样本，超过最少 20 条门槛；
- 分布为 ignored 60、created 11、unchanged 52、updated 9；
- 接受窗口 `2026-08-23T09:59:59.954Z` 至 `2026-08-25T03:38:47.475Z`；
- legacy schema skipped 0、semantic failure 0、重复 accepted message fingerprint 0；
- 每条严格血缘均为 `result.json -> processed message -> shadow decision`；
- 审计外部写入 0，未输出原始业务内容。

结论：Dida projection 严格门禁已通过。handoff 自包含要求由 ADR 0061 固化；已经缺失的旧路径历史仍未被推断、
合成或伪造。

## 后续门禁

1. 等待 shadow 窗口自然结束后，在同一 handoff state 上重新执行 `audit:shadow --strict`。
2. Dida 严格门禁已通过；维护窗口前继续使用同一 handoff，防止证据来源漂移。
3. shadow 严格审计通过后才运行完整 `npm check`、compat 校验和 preflight，并向常东旭申请明确维护窗口；不得自动切换。

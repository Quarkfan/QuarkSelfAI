# Native cutover gate evidence — 2026-08-25

采集时间：`2026-08-25T03:01:10Z`
代码版本：`db358a6b8c50040723c4286852d496cc544c1039`

## 结论

门禁保持关闭，不进入完整兼容校验、native preflight 或维护窗口切换。本次检查只有本地只读操作，外部写入为 0。

## Shadow 严格审计

审计输入：`var/handoff/139a5aab86f473df6b62/state.json`

- 结构与血缘有效：`valid=true`，blocker 0；
- 172 条决策、79 个 matter、23 个任务快照、3 条反馈；
- 169 条完整 source/context、3 条 durable receipt、0 条无来源决策；
- 19 条差异、42 次任务变更；
- 窗口截止 `2026-08-27T11:52:20.935Z`，当前 `windowComplete=false`、`readyForEvaluation=false`；
- 唯一 warning：`shadow-window-in-progress`。

## Dida projection 严格审计

约定输入 `/Users/edy/BlackLakeWork/codex-lark-bridge/var/state.json` 与同目录 `var/dida` 已不存在；当前 handoff
只含 `state.json/config.json`，没有 `dida/**/result.json`，因此不能从现存证据重跑 current-schema、语义、重复与
严格血缘审计。此前观察到的聚合结果不能替代当前可复核审计，故不作为本次通过证据。

该交接缺陷已由 ADR 0061 和提交 `71dbf0b` 修正：以后的 handoff 强制携带 Dida 文件、原始修改时间和逐文件哈希清单。
已经缺失的历史文件没有被推断、合成或伪造。

## 后续门禁

1. 等待 shadow 窗口自然结束后，在同一 handoff state 上重新执行 `audit:shadow --strict`。
2. 只有找到原始 Dida result 文件或获得一批新的、可自包含且满足最少 20 条的 current-schema 严格样本，才重新执行
   `audit:dida-projections --strict`。
3. 两项均通过后才运行完整 `npm check`、compat 校验和 preflight，并向常东旭申请明确维护窗口；不得自动切换。

# 从 codex-lark-bridge 迁移

架构边界见 `docs/adr/0002-compatibility-provider.md`。当前兼容包只是临时叶子 Provider，DSH/Cordis
仍是目标内核。2026-08-23 已按 ADR 0004 完成单消费者切换：QuarkSelfAI 监管兼容 Provider，旧服务停止；
后续仍须逐项用 DSH-native 插件替换兼容能力并保留回滚路径。

## 阶段

1. **契约固化**：导出现有消息、任务、审批、会话和通知语义，建立脱敏回放集。
2. **影子读取**：新旧系统同时读取；新系统禁止外部写入，只比较归一化、去重和决策结果。
3. **单投影接管**：先接管内部状态投影，再接管滴答或飞书通知中的一个；每次只迁移一个写通道。
4. **执行器接管**：Claude Code 主执行，Codex 只在结构化失败条件下兜底；验证不存在双执行。
5. **正式切换**：冻结旧消费者 checkpoint，迁移 action ledger，切换单一消费者并验证补偿扫描。
6. **观察与退役**：保留可回滚窗口；确认无丢消息、重复任务或越权回复后再停旧服务。

## 硬门禁

- 历史回放无外部写入且去重结果一致；
- 重点联系人、本人私聊、@我、外部群识别、正式回复审批均有契约测试；
- 卡片 action 和长时间等待可在重启后恢复；
- 滴答任务创建/更新/完成清理不产生 note；
- 飞书 CLI 断线、升级、schema 变化和恢复通知均通过故障演练；
- 任一 action 只有一个实际 executor；
- 有明确一键回滚到旧 bridge 的操作手册。

本地可执行 `npm run takeover:preflight` 查看机器可读门禁。它在能力未齐、配置不可读或没有显式
批准时必须以非零状态退出。`audit:legacy-state` 仅输出文件 fingerprint 和结构统计，不复制、不修改
旧状态，也不打印业务内容。

常东旭可按 [ADR 0004](adr/0004-owner-accepted-early-cutover.md) 明确接受当前机器清单中的具体证据缺口，
但必须精确列出全部 incomplete ID。该模式不会修改 feature parity，不能使用通配符，也不能自动接受以后
新增的风险；状态交接、单消费者和回滚门禁仍不可绕过。

需要演练状态复制时使用：

```bash
npm run snapshot:legacy-state -- /absolute/legacy/state.json /protected/staging-directory
```

快照以内容哈希命名、权限为 `0600`，写入后重新读取校验；同名内容只复用，永不覆盖。源文件只读。
这只是迁移快照，不会改变现网写入点，也不能直接作为切换授权。

快照或最终冻结状态需执行：

```bash
npm run audit:legacy-handoff -- /absolute/state.json --strict
```

排队要求、待确认调研和慢速外部请求属于必须转移的可恢复工作，不要求清空；审计会聚合报告这些数量。
真正阻塞切换的是不可恢复的队列结构、重复状态 ID 或无效的运行时间戳。业务 `dueDate` 异常只作为
兼容警告，原值保留，DSH-native 导入时再规范化。

不要把旧 `config.json` 直接交给新兼容包。旧配置没有显式 `varDir` 时，新包会落到自己的空状态目录。
只读 rehearsal 或最终冻结后，使用交接准备器生成内容寻址、`0600`、拒绝覆盖的状态与配置：

```bash
npm run prepare:compat-handoff -- \
  /absolute/legacy/config.json \
  /absolute/legacy/var/state.json \
  /absolute/quark/var/handoff
```

生成配置会固定 `varDir`、滴答凭证路径以及 lark/dida/Claude/Codex 的当前绝对可执行路径。准备器不修改
源文件、不打印 token，并在返回前执行 handoff state、CLI 和滴答凭证权限预检。相同输入复用同一目录，
任何同名异内容文件都会失败；正式切换必须在冻结旧消费者后重新运行，不能使用早先 rehearsal 的旧快照。

随后以生成的 `configPath` 执行：

```bash
COMPAT_CONFIG_PATH=/absolute/handoff/config.json npm run takeover:preflight
```

预检要求显式 `varDir`、可读且 handoff-safe 的 `state.json`、四个本地 CLI 均可执行、滴答授权文件为
仅 owner 可读写且含 token。它仍不会代替 feature parity 和 `TAKEOVER_CONFIRMED=true` 两道门禁。

历史滴答 worker 结果可做无写回放：

```bash
npm run replay:legacy-dida -- /absolute/legacy/var/dida
npm run replay:legacy-dida -- /absolute/legacy/var/dida --since 2026-08-21T16:00:00Z --min-task-projections 20 --strict
```

回放只读取 `result.json`，复用当前任务准入、标题、标签、批准、调研和通知验证器；报告只输出聚合数量、
错误类别和哈希化任务标识，不输出消息、标题或任务正文。门禁收敛后追加 `--strict`，任何不兼容或重复创建
都应返回非零。

仅按文件时间过滤不足以证明样本确实被现网接受。正式门禁使用严格血缘审计：

```bash
npm run audit:dida-projections -- \
  /absolute/legacy/var/dida \
  /absolute/legacy/var/state.json \
  --min-task-projections 20 --strict
```

它要求每个计数样本同时满足：`result.json` 完全匹配当前 JSON Schema；通过当前语义验证器；对应消息已经
处理；并能与影子 decision 的 messageId、taskAction 和 taskId 对上。旧 schema 只计入
`legacySchemaSkipped`，不能冒充当前证据。`--min-task-projections` 防止“没有新待办样本”空跑通过；切换
至少要求 20 个真实 current-schema projection，且不得用测试任务补数。

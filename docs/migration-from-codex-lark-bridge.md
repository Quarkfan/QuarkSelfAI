# 从 codex-lark-bridge 迁移

架构边界见 `docs/adr/0002-compatibility-provider.md`。当前兼容包只是临时叶子 Provider，DSH/Cordis
仍是目标内核；迁移准备不得改变旧服务的运行状态。

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

历史滴答 worker 结果可做无写回放：

```bash
npm run replay:legacy-dida -- /absolute/legacy/var/dida
npm run replay:legacy-dida -- /absolute/legacy/var/dida --since 2026-08-21T16:00:00Z --min-task-projections 20 --strict
```

回放只读取 `result.json`，复用当前任务准入、标题、标签、批准、调研和通知验证器；报告只输出聚合数量、
错误类别和哈希化任务标识，不输出消息、标题或任务正文。门禁收敛后追加 `--strict`，任何不兼容或重复创建
都应返回非零。

`--min-task-projections` 防止“时间窗口内没有待办样本”造成空跑误通过。切换门禁至少要求当前 schema
生效后的 20 个真实 task projection 全部通过。

# 架构

## 分层

1. **DSH/Cordis 内核**：生命周期、插件装配、session/event、approval、job、持久化。
2. **Channel adapters**：飞书 CLI、滴答 CLI/MCP、日历等外部协议；只负责能力发现、传输和规范化。
3. **Assistant domain**：matter、action、approval、follow-up、deduplication、settlement；不依赖 CLI 参数。
4. **Policy plugins**：本人私聊直办、外部群禁言、正式回复审批、重点联系人、黑湖路由等规则。
5. **Executor providers**：Claude Code 优先，Codex 异常兜底，DSH native 可选；同一 action 只能有一个实际执行者。
6. **Projections**：滴答任务、飞书卡片、Codex 任务侧栏都是领域状态的投影，不是真源。

## 策略层

用户的自然语言偏好会编译为受限、版本化的策略 DSL。模型只参与候选生成；确定性验证、历史样本模拟、紧急消息保护、审批和运行时匹配都在本地代码完成。策略不能包含任意代码或工具调用。详见 `docs/policies.md`。

## 飞书 CLI 快速适配

业务插件只消费 `NormalizedChannelEvent` 和稳定的 `LarkCliService`，不拼接 CLI 参数。适配器启动时：

1. 探测 CLI 版本；
2. 调用 `event list --json` 获取实际能力；
3. 对必需 EventKey 调用 `event schema ... --json`；
4. 校验身份、权限和 schema，并生成 fingerprint；
5. 缺少必需能力时 fail-closed；新增字段完整保留在 `raw`；
6. 契约变更只修改 adapter/normalizer，不波及路由、审批和任务逻辑。

后续把 `lark-cli api` 的 endpoint discovery 也收敛到该 provider，按 endpoint capability 生成 typed binding。

## 状态原则

所有消息先进入追加式事件日志，随后聚合成 matter/action。重复消息、迟到消息和状态更新必须定位同一
matter：优先更新已有 action 或投影，只有语义上出现新的责任、截止时间或独立交付物时才新建。
外部写操作由 durable action ledger 记录审批、执行者、重试和 supersede 关系。

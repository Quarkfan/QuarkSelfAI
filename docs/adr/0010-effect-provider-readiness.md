# ADR-0010: Effect provider 是原生切换的独立门禁

状态：Accepted（2026-08-24）

## 决策

跨重启 workflow 只描述状态转移，不直接调用飞书、滴答、Codex session 或执行器。每个 workflow 模块必须在
模块目录的 `requiresEffects` 中声明外部 effect；adapter 模块通过 `providesEffects` 声明唯一 provider。

模块允许登记尚未实现的 provider，以便渐进建设，但缺口必须进入 `nativeCutoverBlockers`。运行归属切换为
active 后，所有 required effect 必须存在唯一 active provider，否则架构校验失败。重复 provider 同样失败，
避免切换时双写或同一外部动作由两个 adapter 竞争执行。

本 ADR 最初使用单一 `status` 表达 provider readiness。该部分已由 ADR 0011 替代：目录现在分别报告
`implementation` 与 `runtime`。只有 `runtime=active` 的 provider 才能满足 active consumer；已经实现但尚未
切换的 provider 会计入 implemented coverage，而不会计入 active coverage。

## 原因

工作流单元测试只能证明状态机逻辑，不能证明外部动作已经接通。此前多个 native 候选会发出持久 effect，但除了
内部打开跟进子流程外没有正式 handler；如果只看 feature parity 或 workflow 测试，可能错误批准接管。

## 后果

- adapter 可以替换，但 effect id 是版本化契约；破坏性变化使用新的 `.vN`。
- provider 的幂等、审批、结果 schema 和故障分类仍需各自契约测试。
- compatibility host 不算 native workflow provider；只有通过 durable effect runtime 注册的实现才可登记。

# ADR-0010: Effect provider 是原生切换的独立门禁

状态：Accepted（2026-08-24）

## 决策

跨重启 workflow 只描述状态转移，不直接调用飞书、滴答、Codex session 或执行器。每个 workflow 模块必须在
模块目录的 `requiresEffects` 中声明外部 effect；adapter 模块通过 `providesEffects` 声明唯一 provider。

planned 模块允许保留尚未实现的 provider，以便渐进建设，但缺口必须进入 `nativeCutoverBlockers`。模块标记为
native 后，所有 required effect 必须存在唯一 provider，否则架构校验失败。重复 provider 同样失败，避免切换时
双写或同一外部动作由两个 adapter 竞争执行。

目录中的 provider 只有 `status=native` 才计入覆盖率；`planned` provider 只表示目标实现已登记，不能提前消除
切换 blocker。生产 profile 中默认禁用的 adapter 也不得仅因代码存在而宣称完成接管。

## 原因

工作流单元测试只能证明状态机逻辑，不能证明外部动作已经接通。此前多个 native 候选会发出持久 effect，但除了
内部打开跟进子流程外没有正式 handler；如果只看 feature parity 或 workflow 测试，可能错误批准接管。

## 后果

- adapter 可以替换，但 effect id 是版本化契约；破坏性变化使用新的 `.vN`。
- provider 的幂等、审批、结果 schema 和故障分类仍需各自契约测试。
- compatibility host 不算 native workflow provider；只有通过 durable effect runtime 注册的实现才可登记。

# ADR-0066: Tool authorization decision 属于 policy

状态：Accepted（2026-08-25）

## 背景

`dynamic-plugin-authoring` 被登记为 workflow，但实现只监听 DSH `tools/pre-execute`，根据动态插件是否含 client half
返回 allow/ask。它不持久化状态、不产生 durable effect，也没有等待或重试阶段；workflow 标签掩盖了真实职责。

## 决策

1. `dynamic-plugin-authoring` 保持 feature，但 layer 改为 policy。
2. 动态代码激活与删除仍使用 DSH 原生审批 seam；这属于产品安全策略，不进入通用授权或 workflow 骨架。
3. 架构检查把同时使用 `PreToolDecision` 和 `tools/pre-execute` 的模块约束为 policy，防止审批策略被误登记为 workflow。
4. 只有需要持久状态、deadline、重试与 effect outbox 的插件沉淀过程才建立 durable workflow。

## 后果

模块图可以区分即时授权策略和跨重启业务流程。未来新增工具审批规则可以替换或组合 policy feature，不需要引入空状态机；
真正的长期插件生成/验证/发布流程仍可在其上新增独立 workflow。

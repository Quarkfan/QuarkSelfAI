# ADR 0013: Durable Action Ledger 不持有隐式会话

- 状态：Accepted
- 日期：2026-08-24

## 背景

`ActionLedgerService` 同时暴露 durable 入队和一个需要 `Agent` 参数的 `runOnce`。仓库没有生产调用方为该方法
提供 DSH agent，因此“已委托”可能只代表写入数据库，并不代表存在执行闭环。更危险的是，若后台 timer 随便
挑一个活跃会话作为 parent，会把错误的工作区、上下文和权限带给 Claude/Codex 子执行器。

## 决策

1. durable action ledger 只负责 action、approval、租约和结果状态，是不依赖会话的骨架能力；
2. `DurableExecutorWorker` 与 `ActionWorkerService` 归入 `agent-bound-action-worker` feature；
3. worker 的调用者必须显式提供 exact DSH `Agent`，不得从全局 registry 随机选择或缓存“最近会话”；
4. 在 conversation dispatcher 能为飞书来源创建/恢复可见会话、保留工作区和回传关联前，该模块保持
   `implementation=partial,runtime=inactive`；
5. 入队成功不得在界面或消息中表述为“正在执行”。控制面需要分别展示 queued、assigned-session、executing
   和 completed。

## 后续闭环

conversation dispatcher 需要以 `source conversation + explicit target session + workspace` 为稳定路由键：本人私聊
可创建新会话或续接明确目标；普通重点消息进入独立事项会话；执行完成后通过 durable effect 回传。它是消息协作
功能，不进入 action ledger 骨架。

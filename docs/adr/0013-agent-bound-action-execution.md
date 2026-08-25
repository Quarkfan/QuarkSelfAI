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
3. worker 按 action ID 确定性创建或恢复 exact DSH 父会话，不得从全局 registry 随机选择或缓存“最近会话”；
   每个已配置 workspace 使用独立 worker lease identity，action 只能由同 workspace 的父会话执行；
4. action enqueue、批准和 retry release 提交后立即或按 `availableAt` 精确唤醒 worker；10 分钟扫描只恢复进程重启、
   漏 hint 或失效 lease，不使用业务 `sleep` 或高频空轮询。相同 action 的基础设施失败会恢复同一个父会话；
   确定性边界失败直接结算，不跨执行器重复；
5. 入队成功不得在界面或消息中表述为“正在执行”。控制面需要分别展示 queued、assigned-session、executing
   和 completed。

## 后续闭环

conversation dispatcher 需要以 `source conversation + explicit target session + workspace` 为稳定路由键：本人私聊
可创建新会话或续接明确目标；普通重点消息进入独立事项会话；执行完成后通过 durable effect 回传。它是消息协作
功能，不进入 action ledger 骨架。

该 dispatcher 已负责本人私聊的可见对话；action worker 则负责 action ledger 中的后台调研/执行，两者不竞争同一
队列。worker 已为 `implementation=ready,runtime=inactive`，profile 在 compat 模式强制禁用。启用仍需完成真实
只读 action 回放和执行所有权切换，不能因代码完成而自动消费生产队列。

# ADR-0072：持久化状态以窄 capability 注入，不提供聚合 service locator

状态：Accepted（2026-08-25）

## 问题

`quarkState: DurableStatePort` 同时暴露 event、workflow、action、signal、checkpoint 和 policy 的全部方法。业务插件为
查询一个 workflow 或追加一个 event，就能直接 claim/settle action、决定 approval 或修改其他功能 checkpoint。
这与数据库 provider 无关，而是骨架把连接聚合对象误当成了扩展契约。

部分 workflow feature 还直接调用 `createWorkflow`，绕开 definition registry、版本检查和统一 wake 语义。

## 决策

- 一个 durable-state provider 继续拥有唯一数据库连接和事务实现，但不再提供 `quarkState`；
- 按 event append、event consumer、event query、workflow runtime、action enqueue、action decision、action worker、
  signal、checkpoint、policy 十种能力分别提供冻结的窄对象；
- `quarkWorkflows` 增加只读 `workflow(id)`，业务 workflow 查询和创建统一走 runtime port；只有 workflow runtime
  持有底层 `quarkWorkflowState`；
- action ledger 只提供 enqueue，不再把 `decideApproval` 暴露给所有 ledger 客户端；decision capability 暂只由
  state host 提供，未来必须由已验证交互 adapter 显式取得；
- 架构检查禁止重新出现 `quarkState`，并限制 workflow/event consumer/action enqueue/worker/decision 等高权限端口
  的模块 owner；新增普通 channel 仍可通过开放的 event append port 接入。

## 结果

具体数据库仍可在 SQLite/PostgreSQL 之间替换，插件却只能获得实际需要的最小权限。新增“肉”不会因为方便而拿到
整个状态真源；workflow 创建、action claim 和 approval decision 重新回到各自唯一的骨架边界。

# Client Matter 端口：第二批实施计划

状态：实施前评估通过；日期：2026-10-12。第一批[本地存储计划](internal-matter-projection-batch-1.md)与[总计划](feishu-first-workspace-implementation-plan.md)继续有效。

## 新发现的边界

`message-intake-native` 由 DSH/Cordis 的 `quarkWorkflows` 驱动；第一批 `local_matter` 位于 `SqliteInactiveClientStateV1`。当前 installed Client 只运行 no-effect worker，尚无飞书 ingress 或 DSH workflow 到 Client 的已授权调用通道。若 DSH effect handler 直接打开同一 Client DB，会绕过 `LocalClientInstanceLeaseV1`、设备身份和 Client 的唯一写入点，形成潜在双写。这不符合单 owner 与 ADR 0092 的客户端 effect gateway 边界。

## 本批唯一实施范围

在现有 `InactiveLocalClientApplicationV1` 内增加一个窄的、本地只读/本地 Matter 写入端口：由已持有实例租约并完成身份恢复的 Application 转调第一批存储方法；关闭后不可读写。调用方仍需显式传 tenant/user，存储层再次比对已登记身份。接口不提供飞书订阅、DSH 注册、网络、调度、执行器或外部 effect。用两个 Application 实例竞争同一 lease、关闭后拒绝、恢复后回读、跨 tenant 拒绝、云投影无正文的测试证明边界。

未来第三批应先做架构决策：A）Client 作为飞书事件及 Matter 的唯一 owner，DSH 只通过 signed Execution Envelope 提供推理；或 B）在 Client 单实例监督下托管 DSH/Cordis workflow，并通过精确本地端口写 Matter。两者都必须保留唯一事件 consumer、durable workflow、effect provider、授权真源与写入点，不允许同时激活。选择、跨进程认证/IPC、断线恢复、投影授权及切换窗口需单独 ADR、脱敏 replay 和 owner 精确确认。第三批前不得给 `internal-task-projection` 声明 `providesEffects`，不得把 `dida-optional-new-user` 改为 complete。

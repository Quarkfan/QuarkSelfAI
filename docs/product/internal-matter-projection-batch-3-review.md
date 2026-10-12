# 第三批离线 effect 边界独立复评

状态：**有条件通过未挂载实现**；2026-10-12。复评对象：[第三批计划](internal-matter-projection-batch-3.md)。

现有 Client Matter 端口已由进程 lease 和 enrolled identity 限制，SQLite 对相同 idempotency key 的不同内容失败关闭；这使离线映射可验证。但当前没有可信的内部 Matter 授权真源，也没有 Client 监督 DSH 的运行通道。故本批只允许注入一个显式授权检查端口并测试调用顺序，不得预设默认放行实现、登记实际 effect provider、修改现有 task projection target 或 composition。测试中的 allow stub 仅用于证明映射和拒绝路径，不能作为真实授权证据。

必须把含原始 `sourceEvent` 的 effect 限定在 Client 本地，不写进云投影或日志；适配器只提取稳定 source ID，不持久化飞书正文。若发现 workflow 重试可改变 decision 内容而沿用同一幂等键，优先保持拒绝并由上游显式解决，不覆盖旧 Matter。若旧 `existingTaskId` 意味着跨后端迁移，应另设 reconciliation，而不是把它当内部 Matter ID。

验收仅为 `npm` 类型/测试/架构检查与离线重复/拒绝案例；运行 owner、授权真源、唯一 provider 和无滴答真实首用仍留在 ADR 0186 后续批次。实施若需更改这些范围，先修订计划并复评。

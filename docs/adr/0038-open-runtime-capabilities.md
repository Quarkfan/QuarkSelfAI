# ADR-0038：运行状态使用开放 capability，而非预设消息协议

状态：Accepted（2026-08-25）

## 问题

通用 `RuntimeSnapshot` 曾直接声明 `messageReady`、`cardReady`、`requiredEventKeys` 和 `readyEventKeys`。这些字段把
飞书消费者模型固化进 skeleton/control plane：新增邮件、其他 IM、文件观察器或纯 workflow runtime 都需要修改
骨架和控制台。

## 决策

- `RuntimeSnapshot` 只保留通用进程状态，并通过 `capabilities[]` 接收 provider 自己命名的能力；
- 每项 capability 声明开放 id、是否为健康所必需、状态和可选 detail；
- compat adapter 将每个飞书 EventKey 映射成自己的 `channel-event:*` capability；
- 控制台只显示必要能力就绪数，不解释 capability id 的业务含义；
- 架构检查阻断通道专属 readiness 字段重新进入 runtime status contract。

## 后果

飞书仍可精确证明五条流是否全部 ready，但这个证明属于 adapter。未来 runtime provider 可以报告完全不同的能力，
无需扩充 skeleton union 或修改控制台健康算法。

# ADR 0006: 单一 Durable State Host 与持久化工作流内核

- 状态：Accepted
- 日期：2026-08-24

## 背景

`ActionLedgerService` 原本既拥有数据库连接，又逐渐暴露 event、policy sample、feature signal 等非 action 能力。
如果继续让每个新插件通过它保存私有 checkpoint，action ledger 会变成第二个应用内核。另一方面，滴答维护、
联系人跟进、慢速调研和会话清理都不是一次 action：它们需要跨重启等待、定时唤醒、消费结果并继续下一步。
仅靠进程内 timer 和单动作队列无法可靠表达这些过程。

## 决策

1. `durable-state-contract` 是骨架端口；`quark-durable-state` 是可替换的 infrastructure provider，也是 DSH 进程内
   唯一数据库连接 owner。存储 provider 选择、迁移和关闭都由它负责。它与外层控制面解析到同一个 SQLite 文件
   或 PostgreSQL 数据库，不允许默认生成 DSH 私有第二真源。
2. action ledger、workflow runtime 和 feature 插件只通过 durable state 端口访问数据库；action ledger 不再代理
   event、policy 或 feature state。
3. `quark-durable-workflows` 提供版本化状态机、幂等事件、定时唤醒、原子 transition/effect outbox、effect
   租约和失败重试。
4. workflow definition 必须是业务功能；workflow runtime、状态表和 effect delivery 机制属于骨架。
5. effect handler 必须以 effect id 实现外部幂等。成功或最终失败会作为新事件送回原 workflow，不能靠内存
   callback 继续流程。
6. effect 的投递协议与跨功能的 owner notification port 属于骨架；`task-store.*`、`codex-session.*` 等具名
   外部能力属于 feature contract。一个功能可以依赖另一个功能的公开 contract，不得复制或改名冒充自身能力。
7. workflow reducer 只能用持久状态决定已有实例的节奏；启动配置只初始化新实例，不能在重启后暗改旧实例。
8. `wakeAt` 使用三态更新：省略表示保留既有唤醒点，`null` 表示明确取消，timestamp 表示重新调度。进入外部
   effect 前必须显式清空旧 timer；附带通知的完成/失败事件不得意外冲掉业务重试或保留期。
9. 旧 compat timer 在对应维护窗口之前仍是唯一生产 owner；新增 workflow 表和空 runtime 不构成切换。

## 结果

- 新的长流程不再创建私有 JSON 队列或不可恢复的 `setTimeout` 链。
- SQLite 与 PostgreSQL 共享同一工作流语义。
- 数据库连接、动作执行和业务状态机各自只有一个职责。
- 功能仍需单独实现 Dida、Feishu、Codex session 等 effect handler；骨架不会硬编码这些系统。

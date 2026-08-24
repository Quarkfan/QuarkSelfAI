# ADR-0039：durable inbox 事件驱动唤醒，轮询只做恢复

状态：Accepted（2026-08-25）

## 问题

durable event runtime 曾每秒扫描数据库。它能跨重启恢复，但在没有消息时持续制造无意义查询；同时把处理延迟和
扫描频率绑定，违背守护进程应由真实事件驱动的边界。

让每个 channel adapter 在 append 后直接调用 event runtime 也不可靠：新增通道时容易漏接，adapter 还会反向知道
inbox 的调度实现。

## 决策

- durable state 仅在新 normalized event 成功落库后发布 `quark/event-appended`；重复幂等写入不发布；
- wake listener 失败只记录诊断，不反转已经提交的 append 结果；10 分钟恢复扫描仍能重新发现该事件；
- durable event runtime 监听该事件并用 coalesced wake drain backlog，一次唤醒最多连续执行 100 轮后让出事件循环；
- consumer 注册时也触发 wake，覆盖“事件早于 consumer 装载”的同进程窗口；
- SQLite/PG 扫描保留为 10 分钟恢复机制，覆盖崩溃、重启和进程间无法传递的 wake hint；
- channel adapter 只调用 durable append，不依赖 event runtime。

## 后果

正常消息在落库后立即进入 durable consumer，空闲期不再每秒查询。即时路径仍以数据库为真源，wake 只是提示，
因此丢失或重复提示都不会造成丢消息或重复结算。

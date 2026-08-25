# ADR-0044：durable inbox 重试按 availableAt 精确唤醒

状态：Accepted（2026-08-25）

## 问题

新 event append 已能即时唤醒 consumer，但 handler 临时失败后只把 delivery 的 `availableAt` 写回数据库，没有安排
内存 timer。配置的两分钟 retry 因此必须等下一次十分钟恢复扫描，正常退避与事故恢复被错误混成一条路径。

## 决策

- 将 commit hint 统一为 `quark/event-wake(at?)`：无时间表示当前可执行，timestamp 表示最早重试时间；
- 新 normalized event 首次落库发布即时 wake，重复幂等 append 不发布；
- delivery 非终态 release 成功提交后按 `availableAt` 发布 wake，终态失败不再调度；
- durable event runtime 复用 skeleton `durable-wake-scheduler`，即时 drain 与未来 exact timer 使用同一合并语义；
- 十分钟扫描只恢复进程崩溃、丢 hint、失效 lease 或重启后丢失的内存 timer。

## 后果

`retryDelayMs` 重新成为真实执行语义，而不是“最快也许十分钟后”的提示值。数据库继续是真源；commit 与 hint 之间
崩溃时仍由恢复扫描兜底，重复 wake 也只会触发一次成功 claim。

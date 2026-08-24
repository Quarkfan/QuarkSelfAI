# ADR 0007: Durable Inbox 与独立消费者游标

- 状态：Accepted
- 日期：2026-08-24

## 背景

Channel ingress 已能把规范化事件幂等写入 `assistant_event`，但仅依靠进程内事件回调仍存在 crash gap：数据库
入账后、业务处理前崩溃会留下永远无人处理的事件。一个全局 checkpoint 也无法支持 intake、审计、学习等消费者
以不同速度独立演进。

## 决策

1. `assistant_event` 是 append-only inbox；channel adapter 只负责规范化和入账。
2. `quark-durable-events` 按 consumer name 建立独立 delivery 状态、租约、尝试次数、退避和最终失败记录。
3. handler 必须以事件稳定 ID 幂等创建 action、workflow 或 projection；进程可能在 handler 成功但 delivery 结算前崩溃。
4. 消费者是 feature，租约与重放机制是 skeleton。骨架不理解飞书 @、联系人、表情或滴答任务。
5. compat 切换前 native ingress 和业务 consumer 均保持禁用；空 runtime 与新表不构成消费者所有权切换。
6. 新事件成功落库后由 durable state 发布 wake hint；runtime 合并唤醒并 drain backlog。10 分钟扫描只恢复重启或
   漏唤醒，不作为正常消息延迟机制。详细调度边界见 ADR 0039。

## 结果

- 事件入账与处理之间不再存在不可恢复窗口。
- 新 Channel 和新业务消费者可以独立回放，不共享易冲突的单游标。
- `bridge-compat` 退出后不再需要用私有 JSON 数组模拟消息队列。

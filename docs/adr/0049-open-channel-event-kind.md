# ADR-0049：规范化事件 kind 是开放标识，不是骨架枚举

状态：Accepted（2026-08-25）

## 问题

数据库已经把 `assistant_event.kind` 迁移为开放文本，但 TypeScript skeleton 仍只允许 `message.received`、
`card.action`、`channel.event`。接入日历、邮件、本地 watcher 或新型交互时，要么修改骨架 union，要么把所有事件
伪装成没有语义的 `channel.event`。

## 决策

`NormalizedChannelEvent.kind` 使用开放 `ChannelEventKind` 字符串。adapter 负责生成稳定、版本化的语义 id；feature
消费者按自己声明的 event key/kind 解释，durable event/storage 骨架只持久化、租约和重放。现有三种 kind 保持
兼容值，但不再是封闭全集。架构检查阻止 channel contract 重新出现 kind union。

## 后果

新增 channel 或事件类别不再要求改 skeleton 或数据库 schema。开放字符串不表示放弃校验：具体 adapter 和 feature
contract 仍须验证它们拥有的 id 与 payload，未知事件可以安全持久化并由未订阅消费者忽略。

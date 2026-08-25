# ADR-0062: Source 与 lifecycle identity 使用开放词汇

状态：Accepted（2026-08-25）

## 背景

骨架宣称支持消息以外的 channel，却在 `SourceRef` 中固定 `messageId`、`conversationId`、`senderId`；日历、文档和
未来资源只能伪装成消息。Lifecycle 也把 component kind 固定为 infrastructure/kernel/surface/migration，使长期
骨架直接理解了本应可删除的 migration 类型。

## 决策

1. `SourceRef` 保留开放 channel id，并统一使用 `resourceId`、`containerId`、`actorId`、`eventId`。
2. 飞书 adapter 把 message/chat/sender 原生字段映射到上述通用 identity；业务 policy 仍可在 feature facts 中使用
   chat/sender 词汇，但不得把它们重新放入骨架契约。
3. `ManagedComponent.kind` 改为 provider-owned string。生命周期监管只保存和展示，不按 kind 分支。
4. 架构检查禁止 skeleton 源码重新出现 `messageId/conversationId/senderId`，并阻断 lifecycle kind 字面量联合类型。
5. 原始通道 envelope 继续保存在 event `raw`，协议升级和审计不依赖通用 source 丢失原字段。

## 后果

新增日历、邮件、文档或其他事件源不需要修改 skeleton。飞书 intake、上下文、投影和会话 adapter 仍拥有消息语义，
但只能在 feature 边界内使用；未来 compatibility handoff 导入旧 source 时由迁移 adapter 显式转换，不能让旧字段永久
留在平台 API。

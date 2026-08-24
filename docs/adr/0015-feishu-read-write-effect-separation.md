# ADR 0015: 飞书上下文读取与外发 Effect 分离

- 状态：Accepted
- 日期：2026-08-24

## 决策

`feishu.load-message-context.v1` 由独立的只读 adapter 提供，不与通知、交互卡片或本人代发共享插件开关。它读取
目标消息前后 30 分钟，并在延迟处理时补读最新会话尾部；输出只保留消息 ID、发送人、时间、类型和有界正文。

私聊明确返回 `externalGroup=false`。群聊必须额外读取 chat metadata：只有 `external === false` 才能证明内部群，
`true` 表示外部群，字段缺失或无法解释一律返回 `unknown`。后续正式回复和追问策略必须把 `true/unknown` 都视为
禁止外发，不能通过“上下文读取成功”推断群安全。

只读 context adapter 与外发 adapter 拥有独立 module、effect provider 和启用变量。这样维护窗口可以分别验证
读取准确性与写入授权，也避免为了加载上下文顺带激活任何发送能力。

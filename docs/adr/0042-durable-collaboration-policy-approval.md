# ADR-0042：协作学习拆成 policy engine 与 durable approval workflow

状态：Accepted（2026-08-25）

## 问题

`collaboration-learning-native` 曾被标为 ready，但实际仍由 feature 私有 `setInterval` 驱动，生成的
`collaboration/policy-proposal` 也没有原生消费者。结果是策略草稿可能已经生成，却不会形成常东旭可见、可输入并
明确批准的卡片；若提案投影失败，评估 checkpoint 还会提前推进，导致一天内不再重试。

## 决策

- 拆出 `collaboration-learning-policy`，只负责脱敏样本、注意力分类、安全模拟和候选策略；
- `collaboration-learning-native` 改为 workflow 层，使用 durable schedule workflow 按 `wakeAt` 每日评估，不再持有
  私有 interval；
- 安全候选创建稳定 ID 的 policy approval workflow，通过 `assistant.request-interaction.v1` 发送带批准、拒绝和输入框
  的卡片；card correlation 必须精确匹配 workflow 与 approval ID；
- 只有 `approval.approved` 才产生 activate effect；拒绝只记录反馈，输入文字只补充上下文，不能替代正式批准；
- proposal workflow 成功持久化后才推进 evaluation checkpoint。投影失败由 durable effect 重试，不吞掉候选；
- 架构检查禁止 native feature 新增 `setInterval`，唯一允许位置是 skeleton 的 `durable-wake-scheduler`。

## 后果

“从协作中学习”现在是可恢复、可审计、必须由本人批准的完整能力，而不是一个会悄悄写草稿的后台 timer。policy
判断仍可独立测试，通道卡片仍由可替换 adapter 实现；未来其他周期能力复用 durable workflow，不复制调度骨架。

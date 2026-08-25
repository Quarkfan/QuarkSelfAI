# ADR-0046：影子审计区分完整来源与持久接收回执

状态：Accepted（2026-08-25）

## 问题

兼容影子状态中的 matter source 是给事项摘要使用的有界集合，同一事项超过 20 条消息后会裁剪较早来源；decision
保留窗口更长。旧审计要求每条 decision 都仍出现在 matter source 中，会把“完整上下文已被摘要窗口裁剪、但消息
仍有 durable processed receipt”误报为来源丢失。反过来，仅检查 processed receipt 又无法说明多少决策仍能直接
追溯到完整上下文。

## 决策

迁移审计把 decision 血缘分为三个互斥层级：

1. `decisionsWithFullSource`：message id 仍存在于 matter source，具备 chat、sender、context count 和 intake reason；
2. `decisionsWithReceiptOnly`：完整 source 已被有界摘要裁剪，但 message id 仍存在于 durable processed receipt；
3. `decisionsWithoutSource`：两种证据均不存在，继续产生 `missing-shadow-source-reference` blocker。

审计输出必须单独报告三个数字，不得把 receipt-only 伪装成完整上下文覆盖。窗口完成、样本数量与其他语义规则仍按
原严格门禁执行；该规则仅适用于读取旧 bridge handoff 的 migration audit，不下沉为新骨架的数据模型。

## 后果

接管门禁不会因旧摘要的容量策略被永久卡死，也不会降低真正来源丢失的失败关闭要求。新骨架的 durable inbox、
event、matter 与 decision 继续由数据库事件关系保存完整可审计关联，不依赖兼容 JSON 的有界数组。

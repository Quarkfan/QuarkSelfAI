# ADR-0048：策略骨架开放 fact/effect，助手语义留在产品模型

状态：Accepted（2026-08-25）

## 问题

原 skeleton `policy-contracts` 和 `policy-runtime` 固定枚举聊天、艾特、截止时间、紧急程度、attention、task、reply，
并在通用模拟器中实现“紧急消息不得静默”。SQLite/PostgreSQL 还会识别 `message.received` 并直接生成这些事实。
这让一套具体个人助手策略伪装成骨架：增加日历、邮件或全新的策略效果时必须改内核和数据库 provider。

## 决策

1. skeleton policy contract 只定义开放 dotted fact id、条件树、通用 document/sample/simulation envelope；
2. skeleton evaluator 只做条件匹配、结构上限和由产品注入的 `PolicySchema` 校验；
3. feature `assistant-policy-model` 定义当前协作事实、attention/task/reply effect、样本投影、安全模拟和审批规则；
4. storage port 提供通用 `recentEventPayloads(kind, limit)`，数据库不得解释消息或生成策略事实；
5. control console 与 collaboration workflow 显式依赖 assistant policy feature，composition 不再借 skeleton 名义获得
   产品语义；
6. 架构检查阻止策略骨架重新出现当前产品词汇，也阻止存储 provider 重新解释助手策略。

## 后果

未来新增策略首先扩展或替换产品 policy model，不修改条件内核；另一套助手可以复用同一 ledger、workflow、storage
与 policy evaluator，并提供自己的 fact/effect schema。自然语言策略仍需编译、模拟和本人批准，但这些安全判断由
所选产品模型负责，而不是固化在通用内核。

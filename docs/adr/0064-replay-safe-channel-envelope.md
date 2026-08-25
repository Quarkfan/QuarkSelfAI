# ADR-0064: Durable channel envelope 必须可稳定重放

状态：Accepted（2026-08-25）

## 背景

`NormalizedChannelEvent` 过去只有 TypeScript 类型，没有运行时门禁。插件可提交空 channel/deduplication key、无效时间，
或包含 `undefined`、`Date`、非有限数字的 payload；JSON 数据库会静默删除或改写这些值，导致写入前后和重放结果不一致。

## 决策

1. channel contract 在计算 journal id 前验证 kind、channel、event key、deduplication key 及所有 source identity 非空。
2. `occurredAt` 存在时必须是有效时间戳；payload/raw 必须是普通 JSON object，递归拒绝 undefined、函数、Date、非有限数。
3. durable state 的 `appendEvent` 通过 `eventRecordId` 统一触发该校验，外部插件不能绕过平台入口写入不稳定 envelope。
4. 飞书 adapter 在协议边界删除缺省的 undefined 字段，保留原始 JSON envelope 到 `raw`。
5. 骨架测试使用日历事件证明契约不依赖消息模型，并覆盖空 identity 与不可重放 payload 的失败关闭。

## 后果

事件持久化前后的语义一致，SQLite/PostgreSQL 和重放工具不会因为 JSON 隐式转换产生分叉。具体协议字段如何清理仍由
adapter 负责；骨架只强制可持久、可审计、可重放，不解释业务内容。

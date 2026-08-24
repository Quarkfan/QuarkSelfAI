# ADR-0037：通道协议 envelope 在 adapter 内终止

状态：Accepted（2026-08-25）

## 问题

飞书消息的 `content` 是协议 JSON 字符串。策略样本投影曾在 skeleton/policy 中重新解析这个字段，导致换一个消息
通道或飞书调整 envelope 时必须修改骨架。事件虽然已经叫 normalized event，但协议边界实际上没有终止。

## 决策

- channel adapter 同时保留审计所需的原 payload/raw，并产生跨通道可消费的规范化字段；
- 飞书 adapter 将文本 envelope 提取为 `payload.text`；
- policy sample 只读取规范化 `text`，不回退解析 `content`；
- 原始字段缺失或格式未知时保持 text 缺失，不猜测、不把 JSON 字符串当业务正文；
- 契约测试同时证明标准 envelope、纯文本兼容输入和 raw-only 输入的边界。

## 后果

未来增加邮件、Slack 或其他 IM 时，只需各 adapter 生成相同的规范化文本事实。原始协议仍可回放，但 storage、policy
和 workflow 不再因为保留 raw 数据而获得解析它的权限。

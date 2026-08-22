# Feishu Work Assistant 协作规则

- 架构真源见 `docs/architecture.md` 与 `docs/adr/`。
- 外部 CLI 只能在 adapter 层调用；domain 和 policy 不得拼接命令行参数。
- 事件必须保留原始 payload，写操作必须经过 durable action/approval 状态。
- 新系统通过迁移门禁前不得停止或抢占现网 `codex-lark-bridge` 消费者。
- DSH 与 lark-cli 升级必须运行构建、契约测试、compat 检查和脱敏回放。

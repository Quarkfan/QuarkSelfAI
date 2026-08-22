# Feishu Work Assistant 协作规则

- 架构真源见 `docs/architecture.md` 与 `docs/adr/`。
- 外部 CLI 只能在 adapter 层调用；domain 和 policy 不得拼接命令行参数。
- 事件必须保留原始 payload，写操作必须经过 durable action/approval 状态。
- 新系统通过迁移门禁前不得停止或抢占现网 `codex-lark-bridge` 消费者。
- 默认只做可回滚的增量建设。任何可能改变 DSH/Cordis 核心边界、停止旧消费者、修改 LaunchAgent、
  改变状态写入点、形成双写或执行破坏性迁移的方案，必须先停止执行，向常东旭说明影响、替代方案和
  回滚步骤，只有他明确决定后才能实施。
- `config/feature-parity.json` 是接管门禁真源；必要能力未全部 complete 时禁止切换。
- SQLite 只允许单实例写入；服务器多实例使用 PostgreSQL，但飞书事件消费者仍只能有一个。
- DSH 与 lark-cli 升级必须运行构建、契约测试、compat 检查和脱敏回放。

# QuarkSelfAI

QuarkSelfAI 是基于 DeepSeek Harness（DSH）的通用飞书工作助手。它会逐步替代职责过载的
`codex-lark-bridge`，但在回放、影子运行和状态迁移通过前，不接管现网消息。

当前阶段已经建立：

- DSH/Cordis 树外 Bundle；
- 与业务逻辑隔离的 `lark-cli` capability provider；
- 运行时 `event list` / `event schema` 能力发现；
- 显式 `user` / `bot` 身份、就绪标记和优雅停止约束；
- 保留未知字段的规范化事件契约；
- executor、action ledger 的稳定领域接口。
- PostgreSQL 业务事件、matter/action、审批及投影绑定持久化基线。

DSH 的兼容基线固定在 `compat/dsh-baseline.json`，不把整个 Harness 安装闭包塞进插件的
开发依赖；profile 验证使用工作区 `github/deepseek-harness` 下的正式 checkout。

## 本地验证

```bash
npm install
npm run check
npm run compat:lark
```

`compat:lark` 只执行读取操作。缺少必须事件时返回非零；新增字段和可选事件只进入报告，
不会要求业务插件同步升级。

## DSH profile 接入（尚未用于现网）

```bash
dsh plugin --profile feishu-assistant add .
dsh --profile feishu-assistant --dump-config
```

正式接管前还需完成 `docs/migration-from-codex-lark-bridge.md` 的门禁。

## 文档入口

- [总体架构](docs/architecture.md)
- [本地开发](docs/operations/local-development.md)
- [部署与切换](docs/operations/deployment.md)
- [lark-cli 升级手册](docs/operations/lark-cli-upgrade.md)
- [PostgreSQL 数据模型](docs/storage/postgresql.md)
- [旧 bridge 迁移门禁](docs/migration-from-codex-lark-bridge.md)

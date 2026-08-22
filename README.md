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
- 默认 SQLite、可配置 PostgreSQL 的统一存储接口。
- 可见的本地 Web 控制台，以及 Docker Compose/systemd 服务器部署基线。
- 自然语言策略的受限 DSL、历史样本模拟、版本存储和安全激活门禁。
- 本人私聊总控到策略草案、交互卡片确认和精确 revision 激活的控制链路。
- 默认关闭的现网兼容 Provider，以及能力、配置和人工批准三重接管门禁。

DSH 的兼容基线固定在 `compat/dsh-baseline.json`，不把整个 Harness 安装闭包塞进插件的
开发依赖；profile 验证使用工作区 `github/deepseek-harness` 下的正式 checkout。

## 本地验证

```bash
npm install
npm run check
npm run compat:lark
npm run takeover:preflight
npm start
```

`compat:lark` 只执行读取操作。缺少必须事件时返回非零；新增字段和可选事件只进入报告，
不会要求业务插件同步升级。

`takeover:preflight` 在现阶段返回非零是正确行为。未经常东旭明确批准，不得设置
`TAKEOVER_CONFIRMED=true`，也不得启动兼容消费者。架构保护边界见
`docs/adr/0002-compatibility-provider.md`。

控制台默认打开 `http://127.0.0.1:3210`，使用 SQLite `var/quarkselfai.sqlite3`。服务器部署必须配置控制台令牌和 HTTPS；详见部署手册。

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
- [现网能力差距与接管门禁](docs/feature-parity.md)
- [自然语言策略机制](docs/policies.md)

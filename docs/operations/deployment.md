# 部署与切换手册

## 组件

- 一个 DSH profile 和 QuarkSelfAI Bundle；
- 独立 PostgreSQL 数据库；
- `lark-cli` bot 身份事件消费者；
- Claude Code、Codex、DSH native executor providers；
- 飞书、滴答等投影插件。

## 容器部署

SQLite 单实例：

```bash
export CONSOLE_TOKEN='使用秘密管理系统生成的长随机值'
export CONTROL_PLANE_TOKEN='使用秘密管理系统生成的另一长随机值'
docker compose up -d --build
```

PostgreSQL：

```bash
export CONSOLE_TOKEN='使用秘密管理系统生成的长随机值'
export CONTROL_PLANE_TOKEN='使用秘密管理系统生成的另一长随机值'
export POSTGRES_PASSWORD='使用秘密管理系统生成的数据库密码'
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build
```

服务器必须通过 HTTPS 反向代理控制台，并设置 `CONSOLE_SECURE_COOKIE=true`。不要直接向公网暴露 3210 端口。飞书 CLI 使用出站长连接，不要求公网 webhook，但需要把 lark-cli 配置/凭证以只读 secret 或受限持久卷提供给运行用户。一个应用身份只能保留一套正式消息消费者。

非容器 Linux 可参考 `deploy/systemd/quark-self-ai.service`。服务用户只需代码读取权、数据目录写入权和必要 CLI 凭证；不要用 root 运行。

## 发布顺序

1. 数据库备份并应用迁移。
2. 部署新代码但保持 event consumer 和外部写插件关闭。
3. 执行构建、契约、CLI compatibility 和数据库健康检查。
4. 执行 `npm run takeover:preflight`；未返回 `ready=true` 必须停止，不能用修改 manifest 或跳过测试绕过。
5. 开启只读影子处理，比较新旧系统决策。
6. 冻结旧 consumer checkpoint，确认新系统已加载 action ledger。
7. 获得常东旭对本次切换的明确批准后，才设置 `TAKEOVER_CONFIRMED=true`。
8. 优雅停止旧消费者，确认 server-side subscription 已释放。
9. 启动新消费者并等待消息与卡片 EventKey 的 ready marker。
10. 逐个启用投影和 executor；持续检查双写、重复任务和越权回复。

## 回滚

停止新消费者并确认退出后，从旧 checkpoint 恢复旧 bridge。数据库迁移默认向前兼容；没有经过单独审批不得执行破坏性回滚。事故期间保留原始事件和 action transition，使用补偿处理而非手工改历史。

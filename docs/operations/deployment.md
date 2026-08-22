# 部署与切换手册

## 组件

- 一个 DSH profile 和 QuarkSelfAI Bundle；
- 独立 PostgreSQL 数据库；
- `lark-cli` bot 身份事件消费者；
- Claude Code、Codex、DSH native executor providers；
- 飞书、滴答等投影插件。

本项目默认按个人电脑本地运行设计：LaunchAgent + SQLite + loopback 控制台是主路径。下面的容器、
PostgreSQL 和 systemd 是未来服务器部署的兼容形态，不代表默认把个人文件上传到服务器。

本地模式下，文件访问发生在 executor 所在机器，且只允许 `ASSISTANT_WORKSPACE_ROOTS` 中的真实路径。
消息、任务和控制台只保存意图、状态及摘要；本地文件内容不会因为启用了服务器兼容能力而自动同步。需要
远程部署又需要处理个人电脑文件时，应部署本机 worker 与远端控制面之间的受限任务协议，不能把主目录
直接挂载到服务器。

正式进程默认启动并监管 `feishu-assistant` DSH profile；内核退出会使父守护进程失败退出，交给 launchd、
systemd 或容器 restart policy 退避恢复。`ASSISTANT_KERNEL=off` 只允许用于测试/诊断，不满足生产接管门禁。

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

服务器不应挂载个人主目录。若只运行控制面，设置 `ASSISTANT_EXECUTION_MODE=remote`；需要服务器侧
executor 时，使用 `local` 表示“在该服务器本地执行”，并只将容器或服务账号确实需要的目录写入
`ASSISTANT_WORKSPACE_ROOTS`。工作区边界不能用 `/`。

第三方 Claude 通道的密钥通过服务管理器或容器 secret 注入为 `ANTHROPIC_API_KEY` 或
`ANTHROPIC_AUTH_TOKEN`，不要写入 `cordis.patch.yml`、普通 `.env` 模板或 Git。`ANTHROPIC_BASE_URL`、模型名等
非密钥配置可按 Claude Code 的兼容方式注入。未配置时使用本机 Claude 原生认证；这两种状态必须在接管报告
中区分。

非容器 Linux 可参考 `deploy/systemd/quark-self-ai.service`。服务用户只需代码读取权、数据目录写入权和必要 CLI 凭证；不要用 root 运行。

## macOS LaunchAgent

`deploy/launchd/com.quarkfan.quark-self-ai.plist.template` 是不含秘密的模板。使用
`npm run render:launchd -- --output ... --project-root ... --node ... --environment-file ... --stdout ... --stderr ...`
渲染时必须指定绝对的项目目录、Node、`0600` 环境文件和日志路径；输出
使用 `wx` 创建，存在同名文件时拒绝覆盖。环境文件由 Node 22 的 `--env-file` 读取，令牌不会写进 plist。

在旧 `com.blacklake.codex-lark-bridge` 仍运行时，只允许渲染和执行 `plutil -lint`，禁止 bootstrap 新
LaunchAgent。正式切换必须先获得常东旭批准，再按单消费者步骤优雅停止旧服务、复制最终状态、启动新
服务；失败时先停止新服务，再恢复旧服务。

兼容子进程在 ready 后异常退出会让 QuarkSelfAI 父进程以失败状态退出，因此 launchd、systemd 和容器
的 restart policy 能统一执行退避重启。`/api/health` 在 compat worker 非 ready 时返回 503。

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

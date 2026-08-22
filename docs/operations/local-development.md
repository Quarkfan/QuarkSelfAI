# 本地开发手册

## 要求

- macOS 或 Linux
- Node.js 22.19 及以上
- npm
- `lark-cli` 1.0.88 及以上
- 可选 PostgreSQL 14 及以上
- DSH checkout：工作区的 `github/deepseek-harness`（版本见 `compat/dsh-baseline.json`）

## 验证

```bash
npm install
npm run check
npm run compat:lark
npm run build
npm start
```

默认控制台地址为 `http://127.0.0.1:3210`，数据写入 `var/quarkselfai.sqlite3`。本地 loopback 默认不要求令牌；绑定其他地址时必须设置 `CONSOLE_TOKEN`。

## 本地文件访问

本地执行是默认模式。未设置时，文件白名单只有进程启动目录；个人助手正式运行时应在权限为 `0600` 的
环境文件中显式配置，例如：

```dotenv
ASSISTANT_EXECUTION_MODE=local
ASSISTANT_WORKSPACE_ROOTS=["/Users/your-name/BlackLakeWork","/Users/your-name/Documents/AssistantInbox"]
```

每个条目必须是绝对路径。启动 compatibility provider 前，主进程会校验其中的 `workspaceRoot` 位于
白名单内；校验失败时不会启动子进程。配置文件自身由受信任的启动环境指定，并应保持 `0600`，无需放入
工作区。Web 控制台不会代理本地文件内容。

本机长期运行优先使用 macOS LaunchAgent；SQLite、日志和环境文件继续留在本机。不要为了本地文件访问
把控制台绑定到局域网或公网地址。

内部策略写接口始终要求 `CONTROL_PLANE_TOKEN`。兼容总控和控制层运行在同一台机器时，二者通过继承的
环境变量共享该令牌；不得把它写入 `config.json`、飞书消息或命令参数。

`compat:lark` 只读取版本、EventKey 和 schema，不启动事件消费者。开发时不要在现网 bridge 仍运行时执行
`LarkCliService.start()`，因为 `card.action.trigger` 是单消费者能力。

## 数据库

不设置变量时直接使用 SQLite。需要 PostgreSQL 时复制 `.env.example` 的变量名到本地秘密管理方式中，设置真实 `DATABASE_URL`，再按 `docs/storage/postgresql.md` 初始化。测试不得依赖生产数据库。

# 本地开发手册

## 要求

- macOS 或 Linux
- Node.js 22.19 及以上
- npm
- `lark-cli` 1.0.88 及以上
- 可选 PostgreSQL 14 及以上
- DSH checkout：工作区的 `github/deepseek-harness`（版本见 `config/dsh-baseline.json`）

## 验证

```bash
npm install
npm run check
npm run compat:lark
npm run compat:dsh
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

`compat:dsh` 校验同级 `github/deepseek-harness` 的锁定版本/commit、插件 namespace 形状和隔离 profile 的
最终配置树。它只运行 `--dump-config`，不会启动 Harness。首次初始化命令见 DSH 官方 `plugin --profile`
流程；本机验证 profile 固定放在 `var/dsh-validation`，不作为生产配置。正式本地 profile 使用
`npm run setup:dsh` 在 `var/dsh` 初始化；脚本会先核验 DSH 版本和 commit，再把本项目以 link 方式加入
`feishu-assistant` 并写入 compatibility-only overlay，不会修改同级 DSH checkout。长期原生 profile 使用
`node --import tsx scripts/setup-native-dsh-profile.ts` 初始化为 `feishu-assistant-native`；该入口写入空的
profile-owned patch，只加载本项目长期 bundle。自定义原生名称只能通过 `DSH_NATIVE_PROFILE` 提供，且不能等于
兼容入口的 `feishu-assistant`；环境中的 `DSH_PROFILE` 不会改变原生安装目标。

## 在 DSH 会话里创建临时插件

打开控制台的“DSH 会话”，直接用自然语言描述需要的能力即可，不需要输入 Cordis 指令。模型会使用
`cordis_inspect_*` 确认实际服务和 UI 插槽，再用 `cordis_define` 生成不可变版本。定义不会执行代码；启动或
更新时必须在界面完成一次明确批准。纯 Host 包显示 QuarkSelfAI 的通用 approval，包含 Client 半的包显示
DSH 原生代码审批，不会同时出现两次。

每个动态插件只属于创建它的 DSH 会话，并只保存在当前进程内存中。可以在后续消息中用 `@插件ID` 继续修改；
`cordis_stop` 可立即停用并保留版本，重新运行旧 package 即为回滚，`cordis_undefine` 会再次请求批准后永久移除。
DSH 重启后动态插件自然消失。确认值得长期使用时，应要求助手把实验版本沉淀为本仓库插件并完成常规验证，
不要把内存插件当作部署产物。

## 数据库

不设置变量时直接使用 SQLite。需要 PostgreSQL 时复制 `.env.example` 的变量名到本地秘密管理方式中，设置真实 `DATABASE_URL`，再按 `docs/storage/postgresql.md` 初始化。测试不得依赖生产数据库。

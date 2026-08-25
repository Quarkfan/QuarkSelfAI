# QuarkSelfAI

QuarkSelfAI 是基于 DeepSeek Harness（DSH）的本地优先个人工作助手，飞书是主要交互通道之一。
它已经在 2026-08-23 以 DSH 内核监管的 compatibility provider 接管本机现网；旧
`codex-lark-bridge` 外部仓库与 LaunchAgent 已移除；现网能力由仓库内受审计的 compatibility plugin 承接。
滴答 current-schema 样本与完整影子窗口仍保持真实 partial，
本次按 owner 明确接受的已知风险运行，不把证据缺口伪装成 complete。

当前阶段已经建立：

- DSH/Cordis 树外 Bundle 与可由 Loader 装配的 namespace plugin 入口；
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
- 本地优先执行模式，以及能阻止目录穿越和符号链接逃逸的工作区白名单。
- DSH 官方 Claude Code/Codex Provider、native spawn 与 Claude-primary 串行兜底路由。
- DSH 原生 durable action ledger：精确批准、数据库租约、崩溃接管、退避和陈旧 worker 防护。
- 每日协作自我回顾、低风险 guidance 自动校准、同日幂等简报和高影响策略审批闭环。

DSH 的版本基线固定在 `config/dsh-baseline.json`，不把整个 Harness 安装闭包塞进插件的
开发依赖；profile 验证使用工作区 `github/deepseek-harness` 下的正式 checkout。

## 本地验证

```bash
npm install
npm run check
npm run architecture:check
npm run compat:lark
npm run compat:dsh
npm run compat:blacklake
npm run compat:live-bridge
npm run compat:server
npm run audit:shadow -- /absolute/path/to/legacy/state.json
npm run takeover:preflight
npm start
```

兼容入口的 `npm start` 默认监管 DSH `feishu-assistant` profile；长期原生入口监管隔离的
`feishu-assistant-native`。只有测试或故障诊断才设置
`ASSISTANT_KERNEL=off`。启动器优先使用项目内固定版本的 `node_modules/.bin/dsh`，本地开发可回退到同级
`github/deepseek-harness` 正式 checkout，服务器则必须安装锁定版本。DSH profile 尚未初始化时先执行下方
profile 接入命令。

`compat:lark` 只执行读取操作。缺少必须事件时返回非零；新增字段和可选事件只进入报告，
不会要求业务插件同步升级。

`compat:dsh` 对 `config/dsh-baseline.json` 校验正式 DSH checkout 的版本和 commit，再导入构建产物、读取
隔离的 `feishu-assistant` profile 配置，并短暂启动该 profile 后以 SIGTERM 验证清洁退出。QuarkSelfAI 的
Lark 插件只注册 capability，不在这个烟测中启动飞书事件消费者。首次运行前按下方 DSH profile 步骤把
本地包链接进 `var/dsh-validation`；源码 checkout 还需先执行 `corepack pnpm build`。

`compat:blacklake` 从 BlackLakeWork 三源真源读取当前路由、知识索引和 skill 清单，验证路径、新鲜度哈希、
skill 存在性及多步操作链门禁；不会查询生产系统或执行外部写入。

`audit:shadow` 只输出窗口、数量、分类分布、事项引用、任务准入、通知层级、快照和反馈的聚合问题码，
不输出消息标题或业务正文；加 `--strict`
时，窗口未结束、少于 20 个决策或存在 blocker 都会返回非零。

`takeover:preflight` 只有在最终 handoff、CLI/凭证检查、owner 明确批准全部通过时才返回成功。存在未完成
证据项时还必须按 ADR 0004 精确列出本次接受的 ID；未知或新增 ID 会继续 fail closed。架构保护边界见
`docs/adr/0002-compatibility-provider.md` 与 `docs/adr/0004-owner-accepted-early-cutover.md`。

控制台默认打开 `http://127.0.0.1:3210`，必须使用 `CONSOLE_TOKEN` 登录；令牌只存放在权限为 `0600` 的
`var/runtime.env`，登录后写入 HttpOnly Cookie。控制台提供监控、事项、执行、批准和策略视图，并内嵌只监听
`127.0.0.1:3211` 的 DSH 原生会话工作台。推理端点通过 `openai-completions` 接入，默认模型为
`deepseek/openai/deepseek-v4-pro`，API key 不进入 Git。主存储使用 SQLite `var/quarkselfai.sqlite3`。执行默认发生在本机，
且默认只能访问启动目录；正式本地配置应通过 `ASSISTANT_WORKSPACE_ROOTS` 显式列出允许的工作区。
本地文件只由本机 executor 在白名单内读取，不会自动同步到飞书、滴答、远端数据库或服务器。服务器部署是
可选形态，必须配置控制台令牌和 HTTPS；详见部署手册。

## DSH profile 接入

```bash
npm run setup:dsh
dsh --profile feishu-assistant --dump-config
npm run cleanup:completed-state
npm run register:compat-state
```

从源码验证时，DSH checkout 固定放在同级 `github/deepseek-harness`。隔离验证使用 `var/dsh-validation`；
本机现网使用 `var/dsh` 下的 `feishu-assistant` profile；它组合 DSH base、web-app 与 QuarkSelfAI Bundle，
并叠加 compatibility-only overlay，由父守护统一监管。原生切换前使用
`node --import tsx scripts/setup-native-dsh-profile.ts` 准备独立的 `feishu-assistant-native`。清理命令只删除
终态记录，拒绝在工作队列非空时运行，并保留消息幂等检查点与活动影子窗口。

## 文档入口

- [总体架构](docs/architecture.md)
- [骨架、功能与迁移层边界](docs/architecture-skeleton.md)
- [本地优先个人助手决策](docs/adr/0003-local-first-personal-assistant.md)
- [已知风险提前接管决策](docs/adr/0004-owner-accepted-early-cutover.md)
- [本地开发](docs/operations/local-development.md)
- [部署与切换](docs/operations/deployment.md)
- [lark-cli 升级手册](docs/operations/lark-cli-upgrade.md)
- [PostgreSQL 数据模型](docs/storage/postgresql.md)
- [旧 bridge 迁移门禁](docs/migration-from-codex-lark-bridge.md)
- [现网能力差距与接管门禁](docs/feature-parity.md)
- [需求追踪矩阵](docs/requirements-traceability.md)
- [2026-08-22 接管准备证据](docs/evidence/takeover-readiness-2026-08-22.md)
- [2026-08-22 接管前受控演练](docs/evidence/controlled-rehearsal-2026-08-22.md)
- [2026-08-23 正式切换记录](docs/evidence/cutover-2026-08-23.md)
- [自然语言策略机制](docs/policies.md)

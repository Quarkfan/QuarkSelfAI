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

兼容期进程启动并监管 `feishu-assistant` DSH profile，它在长期 bundle 上叠加 compatibility-only overlay；
原生产品入口固定默认 `feishu-assistant-native`，只接受独立的 `DSH_NATIVE_PROFILE` 覆盖并拒绝复用旧 profile；
兼容期遗留的 `DSH_PROFILE` 不会覆盖原生选择。内核退出会使父守护进程失败退出，交给
launchd、systemd 或容器 restart policy 退避恢复。`ASSISTANT_KERNEL=off` 只允许用于测试/诊断，不满足生产接管门禁。

兼容期的本人私聊总控在 Codex 与 Claude Code 都发生基础设施故障时，使用 DSH `headless` profile 做最后兜底。
该一次性 profile 使用 `var/dsh-fallback`（或配置的 `dshFallbackHome`），不得与内嵌 Web profile 共用
`DSH_HOME`；原始要求写入 `0600` 临时文件而不进入进程参数，完成后立即删除。兜底 session 只保留 7 天，
由现有 session cleanup 周期清理。明确指定 Codex session 和结构化滴答写入不进入这条链路。

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

镜像把 DSH CLI、Claude Code Provider 和 Codex Provider 安装在独立的 `/opt/dsh-runtime`，其 pnpm
11.7.0 锁文件位于 `deploy/dsh-runtime/`；QuarkSelfAI 业务依赖仍由根 `package-lock.json` 管理，避免 npm
arborist 在一个依赖图内解析整个 DSH Profile。容器首次启动时只在持久卷 `/app/var/dsh` 初始化 profile，
并以 `link:/app` 挂载当前版本 Bundle；后续启动复用同一 profile 和 session 状态。初始化失败会直接退出，
不会在没有 DSH 内核的情况下启动兼容消费者。

systemd 安装也必须先在 `/opt/quark-dsh-runtime` 按 `deploy/dsh-runtime/pnpm-lock.yaml` 执行冻结安装，并在
`/etc/quark-self-ai.env` 中配置 `DSH_EXECUTABLE=/opt/quark-dsh-runtime/node_modules/.bin/dsh`、
`DSH_HOME=/var/lib/quark-self-ai/dsh`。兼容期首次启动前必须运行 `npm run setup:dsh`，由安装器同时固定 bundle
列表和 compatibility overlay；只执行裸 `dsh plugin add` 会遗漏 profile-owned 门禁，不是等价安装方式。
不得将 `ASSISTANT_KERNEL=off` 用作绕过。

非容器 Linux 可参考 `deploy/systemd/quark-self-ai.service`。服务用户只需代码读取权、数据目录写入权和必要 CLI 凭证；不要用 root 运行。

## macOS LaunchAgent

`deploy/launchd/com.quarkfan.quark-self-ai.plist.template` 是不含秘密的模板。使用
`npm run render:launchd -- --output ... --project-root ... --node ... --environment-file ... --path ... --stdout ... --stderr ... --application-mode compatibility`
渲染时必须指定绝对的项目目录、Node、`0600` 环境文件和日志路径；输出
使用 `wx` 创建，存在同名文件时拒绝覆盖。环境文件由 Node 22 的 `--env-file` 读取，令牌不会写进 plist。
`--path` 必须显式包含 Node、lark-cli、dida-cli、Claude Code 和 Codex 启动脚本所需目录；launchd 自带的
最小 PATH 会覆盖 env-file 中同名变量，因此 PATH 作为非秘密运行依赖写入 plist。
`--application-mode` 只接受 `compatibility` 或 `native`，省略时保持兼容入口；维护窗口必须重新渲染为 `native`，不能
靠任意脚本路径覆盖来绕过产品入口门禁。systemd 与容器使用同一个 allowlist 变量 `QUARK_APPLICATION_MODE`。

本机已完成正式切换，`com.blacklake.codex-lark-bridge` 仓库与 LaunchAgent 不再是运行依赖。新安装不得
重新 bootstrap 旧服务；升级只替换 QuarkSelfAI 构建产物、校验 Profile，然后由同一个 LaunchAgent 优雅重启。

兼容子进程在 ready 后异常退出会让 QuarkSelfAI 父进程以失败状态退出，因此 launchd、systemd 和容器
的 restart policy 能统一执行退避重启。`/api/health` 在 compat worker 非 ready 时返回 503。

## 发布顺序

1. 数据库备份并应用迁移。
2. 部署新代码但保持 event consumer 和外部写插件关闭。
3. 执行构建、契约、CLI compatibility 和数据库健康检查。
4. 执行 `npm run takeover:preflight`；未返回 `ready=true` 必须停止，不能用修改 manifest 或跳过测试绕过。
   若 owner 明确要求在已知证据缺口下提前接管，按 ADR 0004 精确设置
   `TAKEOVER_ACCEPTED_INCOMPLETE`；未知、遗漏或以后新增的 incomplete 都会继续阻断。
5. 开启只读影子处理，比较新旧系统决策。
6. 冻结旧 consumer checkpoint，确认新系统已加载 action ledger。
7. 获得常东旭对本次切换的明确批准后，才设置 `TAKEOVER_CONFIRMED=true`。
8. 优雅停止 compatibility consumer，确认 server-side subscription 已释放；同一维护窗口把
   `QUARK_APPLICATION_MODE`（或 LaunchAgent 的 `--application-mode`）从 `compatibility` 切到 `native`，由受限入口
   选择器把 `dist/app.js` 切到 `dist/product/app.js`；先初始化 `feishu-assistant-native`，设置
   `ASSISTANT_RUNTIME=native`，并按
   `config/product-composition.json` 一次性满足全部 activation gate 和必需配置。不得在两个入口之间并行试跑。
9. 原生入口先核验 module catalog、产品 manifest、storage provider 和配置，再创建 store、启动 DSH 与控制台；
   任一项未 ready 必须保持停止，不得回退为 control-only 假健康。
10. 启动新消费者并等待消息与卡片 EventKey 的 ready marker；持续检查双写、重复任务、无 worker action 和越权回复。

## 回滚

回滚到上一个已验证的 QuarkSelfAI Git 版本并复用同一 checkpoint，不恢复已移除的外部旧 bridge。数据库
迁移默认向前兼容；没有经过单独审批不得执行破坏性回滚。事故期间保留原始事件和 action transition，
使用补偿处理而非手工改历史。

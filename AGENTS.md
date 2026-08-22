# Feishu Work Assistant 协作规则

- 架构真源见 `docs/architecture.md` 与 `docs/adr/`。
- 外部 CLI 只能在 adapter 层调用；domain 和 policy 不得拼接命令行参数。
- 事件必须保留原始 payload，写操作必须经过 durable action/approval 状态。
- `QuarkSelfAI` 是唯一现网飞书消费者；`packages/bridge-compat` 是受 DSH 监督的兼容插件，不依赖外部旧仓库。
- 默认只做可回滚的增量建设。任何可能改变 DSH/Cordis 核心边界、修改 LaunchAgent、改变状态写入点、
  形成双写或执行破坏性迁移的方案，必须先停止执行，向常东旭说明影响、替代方案和回滚步骤，只有他明确决定后才能实施。
- `config/feature-parity.json` 继续记录能力完整度，但接管状态以已批准的风险接受清单和单消费者证据共同判定。
- SQLite 只允许单实例写入；服务器多实例使用 PostgreSQL，但飞书事件消费者仍只能有一个。
- 产品主运行形态是个人电脑上的本地单实例守护进程；服务器/容器仅为可选兼容形态，不得反向削弱本地
  文件、桌面会话和本机 CLI 能力。所有本地文件能力必须复用统一 workspace policy，默认不得授权主目录，
  也不得自动把文件正文、目录清单或绝对路径同步到飞书、滴答或远端服务。
- DSH 与 lark-cli 升级必须运行构建、契约测试、compat 检查和脱敏回放。

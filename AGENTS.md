# Feishu Work Assistant 协作规则

- 架构真源见 `docs/architecture.md` 与 `docs/adr/`。
- 骨架、功能和迁移代码的机器真源为 `config/module-catalog.json`。新能力先登记分类和依赖并通过
  `npm run architecture:check`：skeleton 不得依赖 feature/migration，feature 不得依赖 migration；迁移模块
  必须有退出条件。`src` 下每个 TypeScript 文件必须在 `owns` 中恰好归属一个模块，真实跨模块 import 必须在
  `dependsOn` 中精确声明且不得保留过期项；没有相对 import 的注入、宿主和外部 runtime 关系放在
  `runtimeDependsOn`。长期 workflow 的外部能力必须登记 `requiresEffects`，native 模块不得依赖缺失或重复的
  `providesEffects`。清单未知字段、越界 `source` 和非法 `hostedBy/exitCriteria/runtime` 组合必须失败关闭。
  `packages/bridge-compat` 不承接新的长期功能。
- 外部 CLI 只能在 adapter 层调用；domain 和 policy 不得拼接命令行参数。
- 事件必须保留原始 payload，写操作必须经过 durable action/approval 状态。
- `QuarkSelfAI` 是唯一现网飞书消费者；`packages/bridge-compat` 是受 DSH 监督的兼容插件，不依赖外部旧仓库。
- 默认只做可回滚的增量建设。任何可能改变 DSH/Cordis 核心边界、修改 LaunchAgent、改变状态写入点、
  形成双写或执行破坏性迁移的方案，必须先停止执行，向常东旭说明影响、替代方案和回滚步骤，只有他明确决定后才能实施。
- `config/feature-parity.json` 继续记录能力完整度，但接管状态以已批准的风险接受清单和单消费者证据共同判定。
- SQLite 只允许单实例写入；服务器多实例使用 PostgreSQL，但飞书事件消费者仍只能有一个。
- `AssistantStore` 只允许具体存储 provider 和连接 host 使用；其他组件必须依赖最小 storage capability port，
  不得把组合存储接口当 service locator。
- 产品主运行形态是个人电脑上的本地单实例守护进程；服务器/容器仅为可选兼容形态，不得反向削弱本地
  文件、桌面会话和本机 CLI 能力。所有本地文件能力必须复用统一 workspace policy，默认不得授权主目录，
  也不得自动把文件正文、目录清单或绝对路径同步到飞书、滴答或远端服务。
- DSH 与 lark-cli 升级必须运行构建、契约测试、compat 检查和脱敏回放。

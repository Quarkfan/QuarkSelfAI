# Feishu Work Assistant 协作规则

- “分身会话”是助手自治维护入口。完整授权、执行闭环、数据治理和确认边界见
  `docs/operations/autonomous-twin-session.md`；收到以该词开头的反馈时必须按该文档推进到验证和上线，
  不得只解释问题或等待用户提供实现指令。
- 飞书注意力策略必须综合置顶、有效标记、会话分组和通知免打扰设置，按 `docs/operations/autonomous-twin-session.md`
  的动态规则决定 10–30 分钟聚合时效和简报方式；这些偏好信号不得替代任务准入、责任和风险证据。

- 架构真源见 `docs/architecture.md` 与 `docs/adr/`。
- 骨架、功能和迁移代码的机器真源为 `config/module-catalog.json`。新能力先登记分类和依赖并通过
  `npm run architecture:check`：skeleton 不得依赖 feature/migration，feature 不得依赖 migration；迁移模块
  必须有退出条件。`src` 下每个 TypeScript 文件、`packages/bridge-compat/src` 下每个现网 JavaScript 文件和
  `scripts` 下每个 TypeScript/MJS 运维入口
  必须在 `owns` 中恰好归属一个模块；原生真实跨模块 import 必须在
  `dependsOn` 中精确声明且不得保留过期项；没有相对 import 的注入、宿主和外部 runtime 关系放在
  `runtimeDependsOn`。长期 workflow 的外部能力必须登记 `requiresEffects`，native 模块不得依赖缺失或重复的
  `providesEffects`。清单未知字段、越界 `source` 和非法 `hostedBy/exitCriteria/runtime` 组合必须失败关闭。
  插件 `runtime` 必须与 Cordis profile 的 compat 门禁一致。`packages/bridge-compat` 不承接新的长期功能。
- Git 已跟踪的配置、migration、Web 静态资源、部署入口、兼容 schema 和插件模板必须在模块目录 `assets` 中恰好
  归属一个模块；只审计已提交资产，不触碰个人未提交的在途文件。
- `layer` 是源码依赖门禁而非说明标签：contract/kernel/policy 不得向 workflow、adapter、provider 或 surface
  反向依赖；跨层装配只允许放在 operations 或显式 `runtimeDependsOn`。
- 每个 feature/provider/surface 自己拥有窄配置；不得引入会聚合 Web、存储、通道、执行器和迁移 selector 的
  全局 `ApplicationConfig`。DSH 配置只属于 `kernel-supervisor`。
- 每个 `runtime=compat` 功能必须恰好属于一个 cutover unit，每个 migration 模块必须恰好属于一个 exit unit；
  没有处置、前置、验证和回滚的自然语言退出说明不能视为可拔除。
- 外部 CLI 只能在 adapter 层调用；domain 和 policy 不得拼接命令行参数。
- Web 控制台、桌面端或其他人机界面是可替换 surface feature；application skeleton 只提供受监管组件扩展点，
  不得直接创建或依赖具体界面。
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
- 主动通知必须遵守 `docs/operations/autonomous-twin-session.md` 的降噪门禁：瞬时基础设施故障静默、恢复只对应已通知故障、普通消息与简报限于 08:00–20:00、超期汇总限于 09:00–19:00 且任务级 24 小时去重；本人手工小维会话不镜像到控制会话。
- 本地网络恢复遵循 `docs/adr/0045-local-network-recovery.md`：仅连续连接类失败可触发诊断，Google 不是唯一健康依据；自动停 Clash、切 Wi-Fi 或修改 IP/DNS 必须通过独立、受限、已批准的特权 helper，未完成安装、回滚和通知演练前不得挂载运行。

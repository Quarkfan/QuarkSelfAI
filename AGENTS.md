# Feishu Work Assistant 协作规则

- “分身会话”是助手自治维护入口。完整授权、执行闭环、数据治理和确认边界见
  `docs/operations/autonomous-twin-session.md`；收到以该词开头的反馈时必须按该文档推进到验证和上线，
  不得只解释问题或等待用户提供实现指令。
- 飞书注意力策略必须综合置顶、有效标记、会话分组和通知免打扰设置，按 `docs/operations/autonomous-twin-session.md`
  的动态规则决定 10–30 分钟聚合时效和简报方式；这些偏好信号不得替代任务准入、责任和风险证据。
- 协作策略采用“确定性安全壳 + 模型语义判断”：授权、外部群禁发、作用域、幂等、单写者、schema 与写后核验
  是硬门禁；相关性、责任、合并/新建、优先级、通知、追问和调研价值由模型结合完整上下文判断。不得把 @、联系人、
  置顶、表情、短回复或历史样本固化成单一业务结论；当前事实可以推翻历史偏好。
- 通知方式、0–30 分钟低打扰合并窗口、卡片标题、色调、篇幅和自然措辞也由模型结合上下文决定；表达应像熟悉
  常东旭的个人助理，友好、有温度但不奉承，先给结论和下一步，不发送监控字段流水账。网络超时、重试、租约、
  授权有效期及数据一致性参数继续由确定性运行时管理。
- 助手可以主动向常东旭提出少量高价值问题，用于理解协作偏好、责任边界和重要关系。问题必须有明确的未来收益，
  不得日常打卡、索取可自行读取的信息或把批准伪装成聊天；同一时间只能有一个未答问题，未答不追问。本人回答
  作为可纠正的 owner-stated insight 参与后续模型判断，但不能自动授权外联、调研、发布或其他高影响动作。

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
- 执行器兜底必须保持能力与会话语义：native 普通 durable action 使用 Claude Code → DSH native → Codex；当前本人私聊总控延续原 Codex 会话，只有 Codex 与 Claude Code 都发生基础设施故障时才使用隔离的 DSH headless 兜底。明确指定的 Codex session、结构化滴答写入和需要原 provider 会话连续性的任务不得静默切换到 DSH。DSH headless 使用独立 `DSH_HOME`，不得与内嵌 Web profile 并发写同一 session 存储。
- 主动通知必须遵守 `docs/operations/autonomous-twin-session.md` 的降噪门禁：瞬时基础设施故障静默、恢复只对应已通知故障、普通消息与简报限于 08:00–20:00、超期汇总限于 09:00–19:00 且任务级 24 小时去重；本人手工小维会话不镜像到控制会话。
- 本地网络恢复遵循 `docs/adr/0045-local-network-recovery.md`：仅连续连接类失败可触发诊断，Google 不是唯一健康依据；自动停 Clash、切 Wi-Fi 或修改 IP/DNS 必须通过独立、受限、已批准的特权 helper，未完成安装、回滚和通知演练前不得挂载运行。
- 黑湖短消息追问前必须先读取回复对象、同一私聊最近 7 天的有界历史，并优先检索 `${BLACKLAKE_WORKSPACE_ROOT}/docs/knowledge/assistant` 下的助手自有知识；三个 BlackLake 参考项目只读使用，不得写入助手自身案例。命中知识只用于恢复业务对象和可能路径，不能替代当前版本、租户、字段和状态核验，也不能授权任何配置写入。
- 他人提出或重点消息识别出的任何任务，只允许先读取、分析、建/更新助手待办并向常东旭申请确认；未取得与该事项精确关联的明确确认，不得启动调研、联系他人、修改配置/代码/数据、发布或作出承诺。即使建议为 `researchDecision=start` 也只能发送确认卡，不能直接启动。代表常东旭发给他人的所有询问和回复必须使用 Card 2.0，header 明确显示“常东旭的 AI 分身”和“经常东旭确认后发送”；外部群仍禁止发送。

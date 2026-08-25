# QuarkSelfAI 骨架与扩展体系

## 一句话结构

DSH/Cordis 提供插件运行内核；QuarkSelfAI 骨架提供稳定契约、领域真源、安全门禁、生命周期和可观测性；
飞书、滴答、BlackLake、执行器和各种协作习惯都是可替换功能；旧 bridge 只是一层有明确退出条件的迁移宿主。

## 骨架

| 能力 | 责任 | 不负责 |
| --- | --- | --- |
| DSH/Cordis runtime | session、插件装配、工具、短时 approval | 具体业务判断 |
| Lifecycle host | 进程组件启动顺序、失败传播、逆序回滚 | 功能定时器和业务重试 |
| Application composition/host | 接收已构造的存储端口与 kernel 配置，装配内核并接收开放组件贡献；统一启动、停止、失败等待和状态快照 | 解析其他模块配置、创建 SQLite/PostgreSQL、Web 控制台、枚举 compat、飞书或某个业务功能 |
| Module catalog | 模块分类、逐文件源码与运行资产所有权、真实 import 依赖、分层方向和迁移退出条件 | 动态启停业务功能 |
| Event/domain contracts | 规范化事件、matter、action、approval | 飞书字段和滴答参数 |
| Durable action ledger | action 入队、批准绑定、租约和结算 | 选择/创建 DSH 会话或驱动 Agent |
| Durable workflow runtime | 跨重启状态机、定时唤醒、effect outbox、租约与重试 | 滴答清理、联系人跟进等具体步骤 |
| Durable event runtime | 入站事件按消费者独立租约、失败重放和结算 | 飞书消息语义或具体业务路由 |
| Storage port / durable-state contract | 跨数据库的一致数据契约，以及 DSH 插件依赖的稳定 `quarkState` 端口 | 创建具体数据库连接、兼容 `state.json` 结构 |
| Policy runtime | 开放 fact/effect 的受限条件 DSL 与 schema 校验挂点 | 具体消息事实、提醒/任务/回复效果和安全模拟 |
| Executor router | Provider 选择、串行兜底、权限边界 | Claude/Codex 的具体协议 |
| Workspace boundary | 本地路径授权与防逃逸 | 上传或同步文件 |
| Platform contract API | 对外导出领域、授权、存储、durable runtime、状态与模块的稳定窄契约 | LifecycleSupervisor、WorkspacePolicy、Web 界面或具体 provider 实现 |

消息接入属于骨架上生长的功能：`message-intake` 使用 durable event/workflow 骨架，但“本人私聊直接委托、重点关注、上下文判断、任务标题/优先级、是否通知”等均留在可替换的 feature policy 与 effect adapter 中。低优先级非艾特消息允许由 10 分钟级 discovery effect 补充，不要求骨架高频轮询。

骨架依赖只能指向骨架。它不能出现“常东旭”“任永强”“滴答”“飞书”“BlackLake”等具体协作语义。
架构检查会扫描 skeleton 所属源码并阻断个人、外部产品、具体 channel 和具体 executor/provider 标识；需要这些名称的
contract、policy、adapter 或 provider 必须归 feature，而不是以通用接口为名留在内核。
通道和 executor 使用插件注册的开放标识；现有 Claude → Codex fallback 是组合配置，不是内核分支。事件 `kind`
由 channel adapter 规范化后持久化，storage 不允许通过飞书 EventKey 猜测领域类型。
消息协议 envelope 也必须在 channel adapter 内终止：例如飞书 `content` JSON 由飞书 adapter 提取为规范化 `text`，
policy/storage 骨架不得反向解析通道原始字段；原 envelope 只保留在事件 payload/raw 供审计和向前兼容。
通用 `SourceRef` 只使用 `resourceId/containerId/actorId/eventId`；`messageId/conversationId/senderId` 属于 IM adapter
词汇，必须在通道边界完成映射。这样日历事件、文档 revision 或其他资源不需要伪装成消息才能进入 durable event。
通用 channel contract 还会在生成 journal id 前验证非空 identity、时间戳和完整 JSON 可重放性；adapter 必须删除
`undefined` 等协议缺省值，不能依赖数据库序列化时静默改写 envelope。
Lifecycle 的 component `kind` 同样是 provider 自报的开放字符串；骨架只做排序、回滚和状态展示，不枚举 migration
或未来功能类型。
Authorization 骨架只校验调用方声明的 scope、grantor、时间和 revision，不内置“owner 才能批准”。当前个人助手的
滴答写入、会话清理和对外动作仍由各 feature 显式要求 `grantedBy=owner`；未来团队审批不会迫使骨架新增角色枚举。
控制台也只能读取通用状态端口；迁移就绪度、compat 诊断和 DSH 进程状态由 composition root 注入，控制台不得直接读取迁移 manifest 或 runtime 实现。
运行态也通过开放的 capability 列表表达，不在骨架中预设“消息、卡片或某组 EventKey”。规范化 event `kind` 同样是
adapter/feature 拥有的开放字符串；骨架不枚举消息、卡片、日历或邮件种类，消费者按自己声明的 event key/kind 订阅。具体 channel provider
负责给出 capability id、是否必要和当前状态；控制台只聚合必要能力的就绪数量。增加邮件、其他 IM 或非消息型
runtime 不需要修改 `RuntimeSnapshot`。

骨架 `module-catalog` 只包含 descriptor、validator 与分析契约，不读取固定产品文件。具体 QuarkSelfAI 清单由
`assistant-module-catalog` provider 加载，清单资产及检查程序属于 `architecture-governance` 产品功能；换一套产品组合
不需要修改骨架 contract。`module-catalog.json` 的 `owns` 是源码所有权真源，不是说明性目录：`src` 下每个 TypeScript 文件、
`packages/bridge-compat/src` 下每个现网 JavaScript 文件，以及 `scripts` 下每个 TypeScript/MJS 运维入口必须恰好
出现一次，原生模块入口也必须由自身拥有。
架构检查会把原生源码和运维脚本的相对 import 映射回 owner，并要求与 `dependsOn` 双向
精确一致；compat package 内部仍只校验所有权，因为它是待删除的迁移代码。operations 可以合法跨层读取，但每条依赖仍必须
如实进入目录，防止脚本成为绕过骨架边界的暗门。注入、宿主和
所有 `scripts/*` 入口必须由 operations 模块拥有；业务 workflow 可以被审计脚本调用，但不能为了同 owner 方便而兼任
运维职责。
外部 live provider 关系单独放在 `runtimeDependsOn`；只有 operations composition 可以用 `mounts` 表达“装入配置但
尚未取得运行所有权”。active consumer 的每个 `runtimeDependsOn` 必须已经 active/static，mounts 则允许预装
inactive/shadow 模块。同一目录的 `assets` 是非源码运行资产所有权真源。架构检查只枚举
Git 已跟踪的配置、SQL migration、Web 静态资源、部署入口、兼容 schema 和插件模板，因此不会接管个人未提交的
界面文件，但任何进入仓库的运行资产都必须明确属于一个 skeleton、feature 或 migration 模块。资产归属是维护责任，
不替代源码 import 依赖。
新增 helper、重复归属、失效路径、未声明 import 和已失效的声明依赖都会阻断 `npm check`。两类依赖都受
skeleton/feature/migration 方向约束，但不会再把编译耦合与运行装配混为一谈。可加载插件还必须声明稳定的
`plugin.profileId` 与
`plugin.packageExport`；检查器会双向核对 Cordis profile、composition `mounts` 和 `package.json#exports`，防止“代码已实现但未挂载”
或“profile 中存在无主插件”。所有已经进入 Git 的 package export 都必须由目标源码或静态资产反向解析出唯一模块
owner；普通 contract、surface 与 metadata export 不能因为不是 Cordis 插件而绕过目录。编译型 export 的
`import/types` 目标必须映射到同一个 owner，Client 静态 export 的 runtime/types 资产也必须属于同一个 surface
模块。未跟踪的本地 UI 实验不进入仓库所有权，任一目标进入 Git 后则立即受完整校验。只声明正确 key、却指向
其他模块构建产物同样失败。`package.json#dsh.bundle.patch` 必须精确指向长期
`cordis.patch.yml`，不能在包入口偷偷恢复兼容 profile。

feature 源码只依赖骨架的窄 contract port，例如 `DurableWorkflowPort`、`DurableEventRegistryPort` 和
`ActionLedgerPort`；仓库内从对应 `contracts` 文件导入，仓库外从稳定的 `./platform` 子路径导入。具体 Cordis
Service 是可替换 provider，只能由 composition/profile 装配，并在模块的 `runtimeDependsOn` 声明。架构检查同时
阻断 feature 直接 import runtime 实现，以及注入端口却漏报 provider 的情况。这样替换调度、事件分发或 action
ledger 实现时，不要求重写业务 workflow。

`layer` 也不是展示标签：contract 只能依赖 contract，kernel 只能依赖 contract/kernel，policy 只能依赖
contract/policy；provider、adapter、workflow、projection 和 surface 只能向各自允许的内层依赖。只有 operations
允许跨层执行组合、审计和迁移。具体矩阵见 ADR 0033。

`contract` 还必须保持行为纯净：可以声明类型、端口、事件和校验函数，但不能实现 Cordis `Service` 或插件
`apply`，也不能声明 class provider。空 catalog、control-only runtime/kernel 和未配置 readiness 等中立实现统一
属于 `neutral-default-providers` 骨架模块；契约文件只保留接口。例如 durable action ledger 虽然只依赖稳定存储端口，仍负责入队和审批写入，因此属于 kernel，不能用
`contract` 标签伪装实现。骨架的空实现同样必须保持中立；control-only 状态不能默认带有 migration、compat 或某个
产品运行模式。

长期 workflow 通过 `requiresEffects` 声明所有外部能力，adapter 通过 `providesEffects` 声明唯一实现。
`implementation` 单独回答代码是否 ready，`runtime` 单独回答当前是否 inactive、shadow、active 或仍归 compat。
纯 `contract` 没有进程、消费者或状态 owner，必须标记为 `runtime=static`，不能用 active/inactive 暗示它在运行或
尚未运行，也不得声明 `runtimeDependsOn`；纯 TypeScript host augmentation 不等于运行时注入。只有可执行模块才进入
active/inactive/shadow/compat 的所有权判断。
没有实现的 provider 与已经实现但尚未激活的 provider 会分别进入 `nativeCutoverBlockers`；active workflow 的
effect provider 必须同样 active。这样“状态机代码写完”和“具备真实外部执行能力”不会再被混为一谈。

## 功能

功能通过骨架契约接入，可以单独替换、停用和测试：

- Channel：飞书消息、卡片、日历、表情、群信息；未来可以增加邮件或其他 IM。
- Projection：滴答任务、飞书通知卡片、会话侧栏。
- Workflow：本人私聊直办、重点消息、交接群、自动跟进、小维调研、BlackLake 路由、协作学习。
- Executor Provider：Claude Code、Codex、DSH native，以及未来其他 harness。
- Authoring：DSH 会话动态插件创作与长期插件沉淀。
- Product composition：选择具体 channel、provider、workflow 和 adapter 的 Cordis profile；它是可替换的产品装配，
  不是 DSH 内核。
- Native product host：`config/product-composition.json` 声明长期能力与真实 module owner，`src/product/app.ts`
  装配存储、DSH kernel、控制台、开放 runtime status/readiness；当前保持 inactive，维护窗口取得进程入口所有权后
  才替代 compatibility entry。

动态插件的创建/删除审批属于 policy feature，不是 durable workflow：它在 DSH `tools/pre-execute` 边界判断 allow/ask，
不拥有跨重启状态机。真正需要等待、重试或外部 effect 的插件沉淀流程才使用 workflow 骨架。

功能可以依赖骨架和其他功能契约，但不能依赖 `bridge-compat`、迁移脚本或旧 JSON 状态。当前仍由兼容宿主
承载的功能在模块目录中标记为 `implementation=ready,runtime=compat`，这是待迁移事实，不是允许继续耦合的接口。

策略骨架只认识开放的 dotted fact id、布尔条件树和 product schema port。`assistant-policy-model` 才定义
`message.mentionsOwner`、`urgency`、attention/task/reply、紧急消息保护、样本覆盖率和审批条件。数据库 provider
只提供按开放 event kind 读取持久 payload 的端口，不解析消息、生成协作事实或决定策略安全性。

SQLite、PostgreSQL 与 `quark-durable-state` connection host 也属于可替换 infrastructure feature：应用骨架只接收
控制台与生命周期所需的窄存储端口，DSH 内的 ledger/workflow/event runtime 只依赖 `durable-state-contract`。当前本地部署实际使用
SQLite；PostgreSQL 保持 ready/inactive，切换配置不应迫使骨架 import 具体数据库。

`AssistantStore` 只是 SQLite/PostgreSQL provider 的组合实现契约，不是业务组件可随意依赖的 service locator。
存储能力按 lifecycle、event journal、signal、feature checkpoint、workflow、action、policy 和 control read model
拆成窄端口；应用 host、控制台、策略 authoring 和 action worker 只接收实际所需端口。架构检查禁止 provider
边界之外重新依赖完整 `AssistantStore`，避免未来增加一种“肉”时被迫扩大所有骨架消费者。具体
`StorageConfig` 属于 durable-state provider，稳定 `platform` API 只导出有意承诺的 `storage/ports`；存储
provider id 是开放字符串，增加新数据库不能要求骨架扩充枚举。

仓库外插件统一从 `@quarkfan/quark-self-ai/platform` 使用稳定 SDK。该子路径自身是 `contract/static`，只能
重导出 contract 模块和纯校验函数；进程生命周期、本地文件策略、默认 provider、数据库连接及具体 runtime Service
都不属于公开承诺。仓库内部仍直接依赖最窄 contract 文件，以便架构检查精确计算 owner 和依赖方向。

任务能力本身也不是一整块：`task-store.*` 是可替换的任务产品读写端口，
`assistant.task-projection.*` 拥有标题、标签、快速摘要、血缘和合并语义，`assistant.followup.*` 拥有是否提醒或
联系他人的判断，`task-maintenance.*` 承载经过 owner 授权的清理动作。滴答 adapter 只能提供 store/maintenance，
不能因为它最终写入任务，就顺带拥有助手的语义判断。具体边界见 ADR 0012。

## 迁移层

迁移层包括 `bridge-compat-host`、旧状态工具、takeover 证据，以及仅为现网 profile 叠加禁用项的
`assistant-profile-composition`。长期 `cordis.patch.yml` 已由 `native-product-profile` feature 拥有；迁移层只保留
`compat/cordis.compat.patch.yml` 和旧 profile 安装入口。它可以读取骨架和功能以完成搬迁，但任何
骨架或功能都不能反向依赖它。每个迁移模块必须有 `exitCriteria`；没有退出条件的“兼容层”就是第二套内核。
`native-migration-plan.json` 还必须用退出单元逐一覆盖所有 migration 模块，明确删除/转正、前置切换、退出拓扑、
验证和回滚；自然语言 `exitCriteria` 不能单独证明脚手架可以拔除。

长期 skeleton/feature 的 source、owns 和 assets 不得落在 `compat/` 或 `packages/bridge-compat/`；只有
`runtime=compat` 的待替代 feature 和 migration 模块允许使用这些物理路径。DSH 与 lark-cli 的长期版本/能力
契约统一放在 `config/`，兼容校验可以读取它们，但不能反过来取得所有权。

当前最重要的结构缺口：

1. 飞书消费者、业务定时器仍由 `bridge-compat` 自己编排，而非 DSH 插件生命周期。
   原生 product host 已实现并保持 inactive，仍需在同一维护窗口切换部署入口与全部 activation gate。
2. 兼容 `state.json` 与 durable database 并存，部分功能仍以前者为真源。
3. 兼容运行时的监控列表仍知道所有具体业务配置键。
4. 所有当前本地插件均已具备模块 owner、package export 与长期 Cordis profile 绑定；普通公共 contract export
   同样按实际目标反向绑定模块 owner，新的 Client export 在静态资产进入 Git 时必须先登记为独立 surface feature。
   剩余问题是这些 native 插件尚未
   取得生产状态、消费者和 effect 所有权，而不是缺少装载入口。`dsh-runtime` 已指向真实 DSH package，不再把
   整份业务 profile 冒充成 skeleton；长期 profile 已归 `native-product-profile` feature，compat overlay 仍是待删除 migration。
5. 原生 `application-composition` 已建立，只装配注入的 durable store、DSH kernel 和开放组件工厂；控制台是由外层
   product composition 显式选择的 surface feature。kernel、workspace 与 Web/control-plane 配置分别归
   `kernel-supervisor`、执行边界和控制台 feature，不存在可随意扩张的全局 application config。运行状态 provider 的标识、
   健康参与度和展示模式也是开放字段。当前 `src/app.ts` 仍通过 `compat-composition` 选择已接管的 compatibility
   consumer；长期 `src/product/app.ts` 不读取 parity、compat selector 或 legacy state，并在模块、开关或必需配置
   不完整时失败关闭。具体边界见 ADR 0022、0027、0052。
6. native workflow 所需的 23 个 effect 均已有实现，但仍全部未激活；机器门禁把实现覆盖与运行所有权分别呈现，
   必须逐 adapter 完成真实只读/写入回放和状态交接后才能切换。飞书通知、交互卡片、只读联系人候选解析和经
   durable approval 的本人代发 adapter 已完成契约实现；同名联系人
   只返回候选，绝不擅自选择。该插件在默认及 compat 模式均强制禁用，在维护窗口完成真实回放前仍保持
   `implementation=ready,runtime=inactive`。
7. durable action ledger 已与 agent-bound worker 分离。worker 按 action ID 确定性创建/恢复 exact DSH 父会话，
   按 workspace 独立领取 lease，并通过 Cordis lifecycle interval 恢复基础设施失败；它不会借用任意活跃会话。
   本人私聊则使用独立 `assistant.conversation.dispatch.v1` 创建或精确续接用户会话并把结果送回 intake workflow。
   两个 adapter 均已实现但仍为 inactive，代码完成不等于已取得生产执行或会话所有权。
8. 飞书上下文读取与通知/代发是两个 adapter。只读 adapter 会补齐延迟处理后的最新会话尾部，并把无法证明
   `external=false` 的群标为 `unknown`；任何外发 workflow 都必须把 external/unknown 作为硬阻断。
9. 交互卡片通过 opaque correlation 精确携带 workflow/effect/approval 归属，回调 adapter 重新验证 owner 后才回投
   durable event。表单输入和业务 choice 的字段名由发卡 workflow 显式声明，骨架不猜测业务含义；输入补充不会被
   推断成批准。该 provider 已实现但仍为 inactive，见 ADR 0016。
10. 后台语义判断使用独立的结构化 DSH LLM effect provider，不占用可见会话，也不把模型调用藏进 workflow
    reducer。输入被标为不可信数据，输出必须通过领域 validator；provider/model 与运行开关由 profile 显式注入。
    重点消息评估已实现，任务与跟进的具体 evaluator 继续作为独立 feature 扩展，见 ADR 0017。
11. 滴答语义投影是独立 feature adapter：每个写 effect 携带 durable owner authorization 与精确 projectId，按
    飞书/projection 血缘更新优先并在写后重新读取验证。NOTE、跨清单、重复血缘和隐式重开完成任务都失败关闭；
    快速摘要每次重写、历史进展只追加一次。任务存储与助手投影仍保持 ADR 0012 的边界，详见 ADR 0018。
12. 工作日跟进不允许模型同时扮演读取器、写入器和结果证明者。workflow 固定串联活动任务快照、结构化建议、逐项
    授权投影以及成功后的通知/外联审批；任一投影失败都不能发送“已维护”。这是可复用的 orchestration 模式，具体
    14 天/7 天、风险和提醒偏好仍属于跟进 feature，见 ADR 0019。

滴答 adapter 已实现超期查询、在白名单清单中核验任务是否完成，以及受限的已完成任务清理。它不会把“查不到
任务”解释为已完成。清理不是仅凭环境开关获得删除权限：常东旭的长期授权会作为不可变快照进入 workflow state，
每个 cleanup effect 都携带授权 ID、授权人、时间、来源、项目、最短保留期和单次上限；adapter 在执行任何 CLI
命令前重新核验范围。当前 adapter 是 `implementation=ready,runtime=inactive` 且双重禁用，真实只读/删除回放
与维护窗口批准前不会接管。

Codex session adapter 已实现 UUID 限制、只读状态核验、归档后复核、`delete --force <UUID>`、七天保留期、
长期授权门禁，以及公共 app-server `thread/read` 活动探针。只有 `idle` 能继续，`active` 会等待，`notLoaded`、
`systemError`、超时或协议异常全部失败关闭。adapter 的代码状态为 `implementation=ready`。当前没有由
QuarkSelfAI 和桌面端共享的 app-server control socket，所以运行状态仍是 `runtime=inactive`；配置缺少 socket 时
插件也不会装载。完成真实只读回放并明确会话运行所有权前，不得启用或接管生产 effect。详细边界见 ADR 0021。

`feature-parity` 的业务完成度与模块目录的运行所有权是两个门禁：compat 功能可以业务上 complete，但只要迁移
计划中的旧所有者、目标模块或目标模块所需 effect 仍非 active，`nativeCutoverReady` 就必须为 false，不能据此
删除 compatibility host。可选存储、未来插件和未纳入本次迁移的能力不会因为 inactive 而污染当前门禁。
这组历史字段只存在于 takeover migration adapter；骨架和控制台使用通用 `OperationalReadinessReport`，当前
adapter 将其呈现为 `native-cutover` gate。以后新增发布、凭证或其他门禁不需要扩展平台枚举，见 ADR 0023。

DSH 内数据库连接已经从 action ledger 拆到唯一的 `quark-durable-state`。新功能不得把私有 JSON state、
业务 timer 或状态读写重新塞进 action ledger；跨重启流程必须使用 `quark-durable-workflows`。
事件、workflow 和 action worker 共用骨架级 `durable-wake-scheduler`：它只合并提交提示、保留一个最早精确
deadline，并以 10 分钟低频扫描恢复进程崩溃或漏提示。业务 feature 不得各自复制 timer/drain/poll 实现。
调度回调会离开 Cordis 插件依赖追踪作用域，因此 runtime 必须在构造期解析并持有声明过的窄端口，不能在原生
timer 回调中重新从 `ctx` 动态取 provider。
这条边界适用于所有长生命周期 service 和 adapter，而不只 timer：durable effect、agent 完成回调、stream、工具
回调等都只能使用构造期捕获的 `state/workflows/agents/llm/ledger` 等窄端口。模块级 `inject` 不能替代嵌套
`Service` class 自己的 `static inject`；架构检查同时禁止延迟 `this.ctx.<injected-service>` 和漏声明 class inject。
新 channel event 成功写入 durable state 后会发布 `quark/event-wake`，失败 delivery 释放时按 `availableAt` 发布同一
hint；durable event runtime 对新事件立即 drain，对 retry 安排精确 timer。10 分钟数据库扫描仅用于进程重启、
监听器暂未装载或漏唤醒恢复，不再每秒空轮询。adapter 只负责 append，不直接依赖或手工驱动 inbox runtime。
workflow create/advance/retry 同样由 durable state 发布最早可执行时间；runtime 对立即 effect 合并 drain，对未来
`wakeAt` 安排精确 timer。30 秒 workflow 空轮询已移除，10 分钟扫描只补偿重启后丢失的内存 timer。
action enqueue、批准和 retry release 也由 durable state 发布 `quark/action-wake`；可执行 action 立即 drain，未来
retry 精确唤醒。原 30 秒 action 空轮询已移除，同样只保留 10 分钟恢复扫描。
业务能力自己的周期工作必须落成 durable workflow `wakeAt`，不得另建 `setInterval`。协作模式学习因此被拆成
纯 policy engine 与 workflow orchestration：每日评估、策略提案卡片、输入补充、批准/拒绝和策略启用都由可恢复
workflow 串联；失败的卡片投影不会提前推进评估 checkpoint。架构检查只允许骨架调度器持有原生 interval。
外层控制面与 DSH 在 SQLite 模式下必须解析到同一个 `SQLITE_PATH`，PostgreSQL 模式下必须使用同一个
`DATABASE_URL`；不得用 `DSH_HOME` 下的隐式第二数据库制造分叉真源。

## 迁移顺序

1. **骨架固化（当前）**：统一生命周期、模块目录、依赖守卫和控制台分类视图。
2. **Channel 原生化**：把五条飞书流变为 DSH-native event source，保持 server-side 单消费者。原生
   `quark-feishu-ingress` 已完成事件入账代码和组合门禁，但在 compat 模式下强制 disabled，尚未取得消费者所有权。
3. **投影原生化**：滴答任务、卡片通知、幂等和摘要迁入 durable matter/action/projection。
4. **Workflow 插件化**：依次迁移 direct-command、focus、engagement、follow-up、Xiaowei、learning、janitor。
5. **真源收敛**：停止业务读取 `state.json`，完成血缘回放和保留期验证。
6. **移除迁移宿主**：在维护窗口切换并验证后删除 `bridge-compat`、旧状态和 takeover 工具。

每一步只迁一个状态所有者。禁止同时让 compat 与 native 模块消费同一飞书 EventKey 或写同一投影。

## 新想法如何接入

1. 先回答：换掉当前外部系统后，这个机制是否仍成立？若否，它是 feature。
2. 在 `config/module-catalog.json` 增加模块，选择符合依赖矩阵的 layer，并精确登记 `owns`、`assets`、真实依赖和
   插件绑定；`architecture:check` 必须通过。
3. 依赖骨架端口，不直接读取其他功能的私有文件、环境变量或数据库表；源码 `dependsOn` 指向 contract，注入端口
   所需的实际 provider 放入 `runtimeDependsOn`，不得 import 具体 runtime Service。
4. 开放式 executor/本地修改走 durable action/approval；已建模业务写入走 durable workflow effect/outbox，高影响
   effect 消费精确 approval 与授权证据。长期等待必须持久化，不靠进程内 `sleep`。
5. 用 DSH 动态插件验证想法可以，但跨重启能力必须沉淀为仓库插件。
6. 为功能提供契约测试、运行状态和停用/回滚路径，再加入正式 profile。

可复制的最小模板位于 `templates/feature-plugin/`。

现有 compatibility 功能的逐单元状态迁移、维护窗口和回滚要求见
[原生化路线](migration/native-feature-roadmap.md)。

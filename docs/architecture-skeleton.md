# QuarkSelfAI 骨架与扩展体系

## 一句话结构

DSH/Cordis 提供插件运行内核；QuarkSelfAI 骨架提供稳定契约、领域真源、安全门禁、生命周期和可观测性；
飞书、滴答、BlackLake、执行器和各种协作习惯都是可替换功能；旧 bridge 只是一层有明确退出条件的迁移宿主。

## 骨架

| 能力 | 责任 | 不负责 |
| --- | --- | --- |
| DSH/Cordis runtime | session、插件装配、工具、短时 approval | 具体业务判断 |
| Lifecycle host | 进程组件启动顺序、失败传播、逆序回滚 | 功能定时器和业务重试 |
| Application host | 接收组件集合并提供统一启动、停止、失败等待和状态快照 | 决定启用 compat、飞书或某个业务功能 |
| Module catalog | 模块分类、逐文件源码所有权、真实 import 依赖和迁移退出条件 | 动态启停业务功能 |
| Event/domain contracts | 规范化事件、matter、action、approval | 飞书字段和滴答参数 |
| Durable action ledger | 批准绑定、租约、重试、结算 | 选择联系人或撰写回复 |
| Durable workflow runtime | 跨重启状态机、定时唤醒、effect outbox、租约与重试 | 滴答清理、联系人跟进等具体步骤 |
| Durable event runtime | 入站事件按消费者独立租约、失败重放和结算 | 飞书消息语义或具体业务路由 |
| Storage port | SQLite/PostgreSQL 一致契约 | 兼容 `state.json` 结构 |
| Durable state host | DSH 内唯一数据库连接所有者，向 ledger/workflow/feature 提供端口 | 执行动作或解释业务信号 |
| Policy runtime | 受限 DSL、模拟、版本和激活 | 任意代码执行 |
| Executor router | Provider 选择、串行兜底、权限边界 | Claude/Codex 的具体协议 |
| Workspace boundary | 本地路径授权与防逃逸 | 上传或同步文件 |
| Control plane | 登录、健康、模块与领域状态可见性 | 硬编码每项业务规则 |

消息接入属于骨架上生长的功能：`message-intake` 使用 durable event/workflow 骨架，但“本人私聊直接委托、重点关注、上下文判断、任务标题/优先级、是否通知”等均留在可替换的 feature policy 与 effect adapter 中。低优先级非艾特消息允许由 10 分钟级 discovery effect 补充，不要求骨架高频轮询。

骨架依赖只能指向骨架。它不能出现“常东旭”“任永强”“滴答”“飞书”“BlackLake”等具体协作语义。
通道和 executor 使用插件注册的开放标识；现有 Claude → Codex fallback 是组合配置，不是内核分支。事件 `kind`
由 channel adapter 规范化后持久化，storage 不允许通过飞书 EventKey 猜测领域类型。
控制台也只能读取通用状态端口；迁移就绪度、compat 诊断和 DSH 进程状态由 composition root 注入，控制台不得直接读取迁移 manifest 或 runtime 实现。

`module-catalog.json` 的 `owns` 是源码所有权真源，不是说明性目录：`src` 下每个 TypeScript 文件必须恰好出现
一次，模块入口也必须由自身拥有。架构检查会把源码的相对 import 映射回 owner，并要求真实依赖出现在
`dependsOn` 中；新增 helper、重复归属、失效路径和未声明跨模块 import 都会阻断 `npm check`。这使分类约束
覆盖全部源码，而不是只检查少数代表入口。

长期 workflow 通过 `requiresEffects` 声明所有外部能力，adapter 通过 `providesEffects` 声明唯一实现。planned
workflow 可以暂时存在缺口，但缺失 provider 会进入 `nativeCutoverBlockers`；模块一旦标记 native，任何 effect
缺口都会直接使目录校验失败。这样“状态机代码写完”和“具备真实外部执行能力”不会再被混为一谈。

## 功能

功能通过骨架契约接入，可以单独替换、停用和测试：

- Channel：飞书消息、卡片、日历、表情、群信息；未来可以增加邮件或其他 IM。
- Projection：滴答任务、飞书通知卡片、会话侧栏。
- Workflow：本人私聊直办、重点消息、交接群、自动跟进、小维调研、BlackLake 路由、协作学习。
- Executor Provider：Claude Code、Codex、DSH native，以及未来其他 harness。
- Authoring：DSH 会话动态插件创作与长期插件沉淀。

功能可以依赖骨架和其他功能契约，但不能依赖 `bridge-compat`、迁移脚本或旧 JSON 状态。当前仍由兼容宿主
承载的功能在模块目录中标记为 `status=compat`，这是待迁移事实，不是允许继续耦合的接口。

## 迁移层

迁移层包括 `bridge-compat-host`、旧状态工具和 takeover 证据。它可以读取骨架和功能以完成搬迁，但任何
骨架或功能都不能反向依赖它。每个迁移模块必须有 `exitCriteria`；没有退出条件的“兼容层”就是第二套内核。

当前最重要的结构缺口：

1. 飞书消费者、业务定时器仍由 `bridge-compat` 自己编排，而非 DSH 插件生命周期。
2. 兼容 `state.json` 与 durable database 并存，部分功能仍以前者为真源。
3. 兼容运行时的监控列表仍知道所有具体业务配置键。
4. 一部分功能虽已具备测试，却没有独立插件 manifest；其长期等待仍需迁入 durable workflow definition。
5. 当前 `app/bootstrap/runtime config` 仍直接组合 compatibility host 和 takeover readiness，因此被明确归为
   `bridge-compat-host` 迁移所有权；原生 application composition 尚未建立，不能把当前启动入口误称为最终骨架。
6. native workflow 当前只实现了内部 `followup.open-outreach` handler；飞书、滴答、Codex session 和 intake
   effect provider 尚未取得状态所有权，现已进入机器切换门禁，必须逐 adapter 补齐后才能切换。飞书通知、
   交互卡片、只读联系人候选解析和经 durable approval 的本人代发 adapter 已完成 mock 契约实现；同名联系人
   只返回候选，绝不擅自选择。该插件在默认及 compat 模式均强制禁用，在维护窗口完成真实回放前仍保持
   `status=planned`。

滴答 adapter 已先实现两个只读 effect：自动化待办超期查询、在配置白名单清单中核验任务是否完成。它不会把
“查不到任务”解释为已完成，也不包含 create/update/delete/complete 命令。完成任务定期删除仍被门禁阻断：
必须先把常东旭的长期清理授权固化为 durable approval 证据并随 cleanup effect 传递，不能仅凭环境开关删除。

`feature-parity` 的业务完成度与模块目录的原生所有权是两个门禁：compat 功能可以业务上 complete，但只要仍有
`feature/compat` 或 `feature/planned`，`nativeCutoverReady` 就必须为 false，不能据此删除 compatibility host。

DSH 内数据库连接已经从 action ledger 拆到唯一的 `quark-durable-state`。新功能不得把私有 JSON state、
业务 timer 或状态读写重新塞进 action ledger；跨重启流程必须使用 `quark-durable-workflows`。
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
2. 在 `config/module-catalog.json` 增加模块、精确 `owns` 文件和真实依赖；`architecture:check` 必须通过。
3. 依赖骨架端口，不直接读取其他功能的私有文件、环境变量或数据库表。
4. 外部写入必须创建 durable action/approval；长期等待必须持久化，不靠进程内 `sleep`。
5. 用 DSH 动态插件验证想法可以，但跨重启能力必须沉淀为仓库插件。
6. 为功能提供契约测试、运行状态和停用/回滚路径，再加入正式 profile。

可复制的最小模板位于 `templates/feature-plugin/`。

现有 compatibility 功能的逐单元状态迁移、维护窗口和回滚要求见
[原生化路线](migration/native-feature-roadmap.md)。

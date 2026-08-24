# ADR-0005：骨架、功能与迁移代码分层

状态：Accepted（2026-08-24）

## 决策

QuarkSelfAI 的所有模块必须明确归入三类之一，并登记在 `config/module-catalog.json`：

1. `skeleton`：承载生命周期、契约、领域真源、安全边界和扩展机制；不得理解某个联系人、业务系统或通知偏好。
2. `feature`：通过骨架契约实现用户可感知能力，可以安装、替换或停用；不得依赖迁移代码。
3. `migration`：为兼容旧实现、状态搬迁、影子验证或切换证据而存在；必须写明退出条件。

分类不是目录标签。每个 `src/**/*.ts` 必须且只能由一个模块的 `owns` 清单持有；模块入口必须归自身所有。
`npm run architecture:check` 校验模块依赖、循环、完整源码所有权、失效路径和源码真实 import 方向。
跨模块相对 import 必须显式出现在 `dependsOn`，因此代表入口不能再掩盖未分类 helper 或隐式反向依赖。
骨架不能依赖功能或迁移模块，功能不能依赖迁移模块。组合根可以装配三者，但不得把迁移实现重新导出成平台契约。

实现成熟度和运行归属是两条轴：`implementation=planned|partial|ready` 描述代码成熟度，
`runtime=inactive|shadow|active|compat` 描述当前所有权。功能可用性不能掩盖其仍处在 compatibility host 中，
`native` 也不是合法的 runtime 值。

架构检查按 module catalog 的实际 owner 扫描全部 skeleton 源码，禁止其中出现飞书、滴答、BlackLake、
Claude/Codex、具体联系人或 takeover 等功能/迁移身份。该保护不依赖目录命名，新增骨架文件也会自动纳入。

## 判断标准

一个能力只有同时满足以下条件，才属于骨架：

- 换掉飞书、滴答、BlackLake、Claude Code 或 Codex 后仍然成立；
- 对未来大多数功能都有复用价值；
- 其变化频率显著低于具体业务规则；
- 可以用稳定契约描述，而不需要知道人名、群名、项目名或消息措辞。

不满足任一项时默认是功能。只为当前切换存在的实现默认是迁移代码，不得因“暂时很重要”升级成骨架。

## 当前结构判断

- DSH/Cordis、生命周期监管、事件信封、matter/action/approval、存储与 durable-state 端口、策略运行时、执行路由、工作区边界、
  控制面和模块目录属于骨架。
- SQLite/PostgreSQL connection provider、飞书、滴答、BlackLake、智造湖小维、重点关注、任永强入群接手、表情语义、自动跟进、通知汇总、会话清理、
  Claude/Codex Provider 和动态插件创作属于骨架上生长的功能。
- `bridge-compat`、旧 JSON 状态读取、影子审计和 takeover preflight 属于迁移代码。

## 当前不理想但暂不暗切的边界

`bridge-compat` 仍在 DSH 外侧拥有飞书消费者、定时器和 `state.json`，父进程同时监管它和 DSH。这与最终的
“DSH 是唯一运行内核”不一致，也使数据库与 JSON 同时成为状态来源。现阶段先用统一生命周期和模块目录把它
隔离成有退出条件的 migration host。

通用 `src/bootstrap/application.ts` 已成为不依赖 migration 的 application composition，通过开放组件列表接收
功能或迁移贡献；稳定的 Web、DSH、工作区配置位于同属骨架的 `src/bootstrap/config.ts`。当前 `src/app.ts`、
`src/config/runtime.ts`、`src/runtime/compat-composition.ts` 和 `src/runtime/compat.ts` 仍认识 compat 启动门禁，
归 `bridge-compat-host` 所有，但 `config/runtime` 只组合稳定配置、存储 feature 配置与迁移 selector；在原生模块
取得状态所有权后，只需替换进程 selector 并删除这组迁移代码，不再搬迁 application skeleton 配置。

把这些消费者和写入点迁入 DSH-native 插件会改变现网核心边界，必须按仓库协作规则另设维护窗口：冻结旧
checkpoint、逐模块切换、验证单消费者与投影血缘，并保留回滚版本。不能为了目录看起来整齐而直接搬代码。

## 后果

- 新想法先登记为 feature，只有证明是跨功能稳定机制后才提升为 skeleton。
- `bridge-compat` 不能再承接新的长期功能；修复现网缺陷可以进入，但必须同时指定目标 native 模块。
- 控制台同时展示能力完成度和模块分类，避免“功能可用”被误认为“架构已原生化”。
- 兼容模块全部退出前，本 ADR 的最终结构目标仍未完成。

# 飞书优先的 Agent Workspace 与 Capability Platform 实施总计划

状态：Monid 扩展复评通过，仅放行只读调研、静态契约与不激活候选；修订日期：2026-10-12
决策依据：Owner 新增目标、`capability-platform-prd.md`、ADR 0092、module catalog、product composition 与当前 completion audit。本文是推进与验收计划，不替代上述架构和机器清单真源。本轮放行判断见 [计划复评](feishu-first-workspace-plan-review.md)。

## 1. 最终产品及非目标

QuarkSelfAI 是唯一产品主线：面向以飞书为工作中心的开发人员和产品人员，提供多用户云端控制、本地客户端执行、可安装与可组合的广义 Capability、版本化 Agent Blueprint、证据驱动成长以及可恢复的安全运行。飞书身份、消息、卡片、日历/文档等能力由 `lark-cli` 默认适配；用户和 bot 身份显式区分。未完成授权时只能进入安全诊断/引导形态，不能伪装成完整可用。

滴答清单不是安装前提、核心数据真源或默认任务后端。当前个人实例的 Dida 投影和维护必须继续运行直到有等价替代和单 owner 切换证据；新用户可以不安装 Dida，使用产品内部 matter/task 状态或以后选择其他受治理的任务适配器。BlackLake 只在独立私有 Work Integration Pack 中存在，不进入通用构建、启动与恢复前置。

`../agent-workspace-kit` 仅作为本地 workspace starter 候选，提供开发/产品两个角色包和新会话发现链；不自建云、消费者、执行器 broker、审批或成长真源。其 Python CLI 是否保留为发行工具，待与 QuarkSelfAI Client/SDK 的边界评估后决定。

## 2. 当前基线与保护集

- 当前 QuarkSelfAI `main` HEAD 为 `d3a5fa99b69fca33d468a566f7e0cb56069d7fdf`（本计划起草时）；远端和运行状态在每批实施前重新回读。
- 用户已有未提交 `package.json`、品牌客户端生成文件和 `.DS_Store`；它们不属于本计划提交集，不得覆盖、删除或借用。
- `config/capability-platform-completion.json` 为 `in-progress`；真实多租户、客户端注册、统一执行、工作流等价、主线去私有依赖、全生命周期仍有未闭合项。
- 云端已存在 effects-off 安装/Agent Studio 证据；客户端已有 inactive 安装证据；这些不能证明真实用户可完整使用，也不能授权第二个消费者或外部写入。
- `config/module-catalog.json` 与 `config/capability-platform-migration.json` 已是逐模块归属/处置的机器真源。不能再建一份平行迁移矩阵；新增“飞书必选、Dida 可选、starter 归属”字段或审计时应扩展现有清单和检查器。

## 3. 总体架构与权属

```text
Feishu work surface (required)      Web Agent Studio (additional surface)
          │ lark-cli user/bot                 │
          └───────── QuarkSelfAI Cloud Control Plane ────────┐
                   tenant / artifact / blueprint / audit       │ signed declarative plan
                                                               ▼
                              QuarkSelfAI Local Client Runtime
                              identity / secret / workspace / approval
                              capability lifecycle / executor negotiation
                                         │
                             Claude Code / Codex / bundled DSH
                                         │
                    developer or product Workspace Starter + private packs
```

云端只持有声明式、签名、版本化计划和脱敏状态；本地客户端持有凭证、工作区 grant、原始证据与 effect gateway。DSH/Cordis 保持唯一内核/组合边界；飞书事件只能有一个当前 owner。Matter、Action、Approval 和任务账本是内核真源，Dida 只是可选投影。安装、加载、授权、运行、外部写入是五个独立状态。

## 4. 机器真源与文档职责

| 真源 | 职责 | 本计划要求 |
| --- | --- | --- |
| `config/module-catalog.json` | 当前源码/资产 owner、运行状态与依赖 | 保持所有权 exactly-once；新增入口先登记 |
| `config/capability-platform-migration.json` | 每模块唯一迁移处置 | 对当前模块仍全覆盖；新增 optionality 不复制另一矩阵 |
| `config/product-composition.json` | 产品模块选用 | 飞书必选与任务适配可选要由产品组合和检查器证明 |
| `config/lark-cli-contract.json` | 飞书 CLI 能力基线 | 区分 user/bot、scope、CLI 版本与缺失降级 |
| `config/capability-platform-completion.json` | 总目标失败关闭验收 | 新增飞书首用与无 Dida 冷启动证据，不降低既有 blocker |
| `config/external-capability-sources.json` | 外部候选来源的静态状态与门禁 | 归属唯一治理模块；被 Git 跟踪后仍须通过资产所有权检查 |
| 本计划及复评记录 | 批次、风险、验收、变更原因 | 每次实质修改先落盘、复评，再实施 |

知识积累继续复用 ADR 0085/0087 的 Experience→Pattern→候选 Skill/Capability→跨执行器评测→人工晋级，不另起第二套自动进化调度器。外部参考只能作为带 revision 的候选证据，不能成为运行时依赖。

### 按需能力发现与 Monid 候选（2026-10-12 扩展）

Skill/Capability 增长时，不把所有全文放进常驻上下文。统一使用“稳定入口与轻量索引 → 按任务意图/权限/环境筛选 → 读取所选契约 → 按需加载 reference/schema → 执行前复核”的发现链。目录只保存 ID、用途、触发边界、owner、来源 revision/digest、适用环境、权限/effect/费用、过期复核时间和详细入口；远端描述、服务端 hints 与工具结果均作为不可信数据，不能覆盖本地策略。每次新会话只做有界路由；结构变化或来源过期再增量刷新，避免全量扫描的 token 成本。记录命中、误触发、未命中、花费和结果，供 ADR 0085/0087 的影子评测与人工晋级使用。

Monid 官方 Skill `0.1.7` 展示了 `discover → inspect → run → poll` 的按需目录模式，可借鉴发现与 schema 检查；其本身是付费外部端点网关，不是我们的通用 Skill 真源，也不是默认工具路由。用户明确指定的工具、现有专用 MCP/API/CLI（尤其 `lark-cli` 与私有 Work Pack）优先。Monid 的首要定位是目录设计参考和可选对标来源；**不以接入 Monid 为产品完成前提**。仅在自身目录或专用工具确有能力缺口、用户/租户选择启用且本地批准覆盖该精确调用时，才考虑真实 Monid 接入。候选状态为 `catalogued / inactive`：本批只保存受控元数据、离线验证和入口说明，不下载/安装其 CLI、复制远程 Skill 到全局发现目录、不配置密钥、不调用 live discover/run、不改变网络权限或执行器组合。

本地目录首批从已有 `capability-artifact-candidates` 和 `external-capability-sources` 编译轻量描述符，而不是维护第二份手填索引。发现只返回 ID、来源、状态、概要、匹配依据和详情引用；inspect 只读取被选中的本地详情并校验本地路径/状态，绝不触发安装、网络或执行。候选与外部来源都必须标识不可运行；排序优先本地专用/第一方，再到外部候选。后续接入真实 Skill 元数据时使用同一描述符契约，但不得把尚未分类/审查的 Skill 自动标记为可执行。离线验收覆盖大目录分页/限额、命中解释、重名/版本冲突、无命中、过期来源和外部候选不得抢先或执行。

未来若批准集成，优先比较用户自带账号的 OAuth 与受控代理两种模式，不使用跨租户共享 master key 作为默认。每个 endpoint 在 inspect 后仍需本地 allowlist、输入字段/数据分类和接收方审查、价格/单位及最大结果数预估、单次与周期预算、精确 effect 批准、幂等与超时、输出脱敏和写后回读。对电话、上传、第三方存储、联系人/人员信息及任何外部写入另设高风险门禁。不得把 Monid 的 `COMPLETED` 当作业务成功，须同时检查 provider HTTP 状态与账单；异步 run 有显式轮询上限。实际 CLI/SDK/Skill 的来源版本、digest、许可证、依赖与安全审核完成后才可申请安装；不得执行 `@latest` 自动升级。

验收拆为：离线索引路由正确、现有专用工具优先、未授权/超预算/敏感输入 fail closed、远端 hints 无法提升权限、异步状态和 provider 错误可解释、跨租户隔离；只有另获精确授权且真实账户/费用/隐私条件满足时，才做最小额度的 live smoke test。Monid 不属于飞书首用或总产品完成的必选依赖。

## 5. 分阶段工作与验收

### A. 基线审计与计划复评（先行）

完整核对根和仓库协作契约、架构、ADR、module catalog、product composition、compatibility host、DSH profile、恢复、私有包与最新自治记录；检查 Git/运行状态。按模块标出：平台核心、通用制品、私有包、迁移工具、等价替代后退役，并增加 required Feishu/optional Dida 的依赖分析。完成本计划的独立评估，确认 starter 不构成第二产品。验收为机器可读清单零遗漏、当前未提交改动保护清单和 blocker 报告。

### B. 飞书优先的首用契约

复用现有 `lark-cli` provider，不在 domain/policy 拼 CLI 参数。定义首次安装、配置、`--as user`/`--as bot`、scope 最小化、只读 health、卡片交互、授权撤销和断线恢复；CLI 成功依据退出码或 `ok=true`，而非 `code=0`。安装可准备 inactive 客户端；飞书授权、消费者启用和外部写入分别取得精确确认。验收：全新测试用户在无 Dida 条件下完成飞书身份检查、权限缺失指引、只读消息/日历能力检查和一条 effects-off 测试链；未授权不产生外部效果。

配置与 profile 不得提供个人工作区的隐式回退路径；缺 `QUARK_OWNER_WORKSPACE` 应失败关闭，由首用流程引导用户显式授予自己的工作区。当前原生 profile 的两处 BlackLake 绝对路径回退必须先清除，现有个人实例的显式配置和 compatibility owner 不变。

### C. 通用工作区 starter 与双角色包

把当前独立原型收敛为 QuarkSelfAI Client 可识别、可版本化、可卸载的 workspace/capability bundle；开发者与产品角色各有真实任务样例、来源路由、交接、知识载体和手册。不得从 starter 中启动第二消息消费者、scheduler 或 executor。验收：两个全新隔离工作区仅凭入口完成任务发现；模板升级不覆盖用户私有内容；无公司路径、真实数据或 Dida 强依赖。

先落地不激活的本地 Capability/Skill 发现目录，再让 starter 和 Client 共同消费受控描述符；不得从 starter 私自维护第二索引或在检索时全量加载 Skill 正文。

### D. Capability、Blueprint 与执行闭环

沿 ADR 0092 现有 contract/SDK/Client/Cloud 增量推进，不重写：补齐真实客户端身份和设备注册、Claude/Codex/DSH 统一 signed Execution Envelope、Agent Studio 组合与版本、能力制品的安装/恢复/升级/回滚。至少对工具、程序包、无头浏览器、私有集成、交互应用取得逐形态生命周期与运行证据；inactive fixture 不冒充运行成功。验收须覆盖 tenant 隔离、断线恢复、设备本地秘密、执行器失败语义、预算/权限和审计。

### E. 成长与积累

将飞书工作证据、开发/产品任务成果、真实故障和用户纠正映射为脱敏 Experience。Pattern 带适用范围、反例、失效/复核时间；候选能力以 inactive/shadow 运行跨 Claude/Codex/DSH 评测，比较发现准确率、效果、成本和越权风险。只有 owner 评审可晋级；晋级不自动增加外部权限。验收：至少各一例开发和产品的有效晋级、一例负迁移被阻断、可回滚；无原始飞书正文或本地绝对路径上传云端。

把 Monid 作为一个可失效的外部候选来源进行离线评测：先比较自身目录、专用连接与 Monid 候选的覆盖率/质量/延迟/费用，不让供应商目录的营销文案或 hints 自动升级为 Skill 指令；仅对被选中的能力加载详细 schema/reference，并保留来源版本与复核时间。

### F. 现有能力迁移、Shadow、单 owner 切换

以当前迁移矩阵逐模块迁移，维持兼容期唯一飞书消费者和 Dida writer。BlackLake 进入独立私有 pack；Dida 转为可选 task adapter，缺失时主线 build/start/recover 与飞书核心仍成立。先脱敏 replay 与 recording sink；再在批准窗口逐 consumer/provider/effect 精确切换，先停旧 owner、确认 checkpoint、再启新 owner，失败反向回滚。不得出现双消费者、双 provider、双调度或双写。

无 Dida 并非把 `task-projection-and-maintenance.required` 改成 `false` 即可：`message-intake-native` 的 task 分支需要 `assistant.task-projection.upsert-intake.v1`，`IntakeService` 在 enabled 时要求投影授权；目前该 effect 由 Dida 投影适配器提供。必须先设计并实现 tenant/user 隔离、幂等、可回读的内部 matter/action 投影真源（不能复用会被 worker 执行的 `enqueueAction` 冒充任务），再在目标 composition 中选择唯一投影提供者；followup/maintenance 的 Dida-only 行为可保持可选但不能让它们成为飞书核心的隐式前置。完成离线回放、故障/恢复及单 owner 验证后，才移除新用户的 `DIDA_*` 必填项；当前个人实例维持原投影直到另批切换。

完成度审计也必须核验非 Dida 的必选投影提供者和必选启动门禁，不能只检查 `required=false` 与删除 `DIDA_*` 字符串；否则机器检查会对一个不可用的假配置报绿。

第一批 Client 本地 Matter 存储之后，必须先通过[第二批 Client 端口计划](internal-matter-projection-batch-2.md)收敛写入点。DSH/Cordis 的消息摄取和 Client 本地 Matter 目前没有安全桥接，禁止让 DSH handler 绕过 Client lease 直接打开数据库；长期事件 owner 与 Client/DSH 执行关系须通过独立 ADR 和精确切换批次确定。

### G. 交付、运维与退出

提供飞书首用、开发者/产品人员上手、Agent Studio、能力发布与回滚、客户端安装/升级、隐私与权限、备份与恢复、故障处理和迁移手册。完成真实新设备/新用户演练、tenant 隔离、无 Dida 演练、私有 pack 卸载演练、云端与本地断线/恢复演练。只有完成度审计所有目标无 blocker、现网无遗留 owner 且用户改动完整保留时才标记总目标完成。

## 6. 精确授权批次

| 批次 | 可自主进行 | 必须另取精确批准 |
| --- | --- | --- |
| A | 只读取证、清单、计划/评估/测试设计 | 远端 push 或不可逆仓库操作 |
| B/C | 文档、contract、离线 fixture、不激活 starter、无副作用 validator | 真实飞书授权/配置、全局安装、消费者或写效果激活 |
| D/E | inactive SDK、隔离测试、脱敏 replay、候选评测 | 安装/执行新第三方代码、运行依赖/凭证/网络变化、真实云服务启用 |
| F/G | 精确迁移方案、影子 recording sink、回滚演练设计 | 数据迁移、私有包激活、consumer/provider 切换、外部写、旧来源删除、现网重启 |

批准单必须绑定 revision、文件与状态范围、允许动作、排除项、数据/权限、验证、回滚和失效条件。既有针对 QuarkSelfAI 的明确批准按其原范围继续有效；本计划不把它扩张到飞书新用户、Dida 去默认或生产切换。

## 7. 计划变更闭环

任何阶段若发现需要修改架构目标、批次、数据真源或权限：先更新本计划和关联 PRD/ADR（若涉及产品或架构决策），记录差异与证据，再更新复评文档；评估通过后才改实现。每批完成后对照机器验收清单和真实运行证据复核，未完成项保持 blocker，不用计划文字宣称完成。

2026-10-12 校验修订：新增的静态来源配置也属于 `module-catalog` 的资产所有权范围。上轮 `architecture:check` 在新文件未被 Git 跟踪时通过，提交后重跑才暴露 unowned asset；本批先将该文件归属现有 `capability-platform-governance`，并在提交后再次执行架构检查，不修改运行时、外部来源状态或授权。

2026-10-12 进度：本地 Skill 元数据采集第一批按[批次计划](local-skill-discovery-batch-1.md)与[独立复评](local-skill-discovery-batch-1-review.md)落地，复用现有离线目录而非新建索引；显式根刷新、轻量描述符、不可执行状态和合成测试已完成。它不代表真实用户/租户 scope、Skill 安装/执行或海量语义调度已完成；B/E 的相关验收继续保持未完成。

2026-10-12 starter 进度：`../agent-workspace-kit` 已在本地 Git `d1beb70` 固定为可替换的模板内容源与离线工具；developer/product 隔离冷启动、静态 Feishu 必选与默认 `lark-cli` 声明、私有 Task/Experience 输入及手册通过离线测试。生成物的 readiness owner 为通用 `host-runtime`，QuarkSelfAI 绑定只存在于未来集成层。它仍未成为 Client 可安装的版本化 bundle，也未取得真实飞书授权、无 Dida 运行或成长晋级证据；C/E/G 的产品验收继续保持未完成。不得让 QuarkSelfAI 运行时依赖该相邻源码绝对路径。

2026-10-12 bundle 进度：starter 来源提交 `cbec01c` 已离线导出 developer/product 两个内容寻址 bundle，空目录安装演练通过；QuarkSelfAI 按[接收计划](workspace-starter-bundle-intake-batch-1.md)与[复评](workspace-starter-bundle-intake-batch-1-review.md)增加纯字节、精确 pin 的跨语言只读验证。该工作使模板脱离邻接源码路径，但尚未成为受信签名制品或 Client 持久安装状态；C/G 的最终验收不变。

2026-10-12 升级安全进度：starter 仓 `docs/BUNDLE-UPGRADE-PREVIEW-PLAN.md` 与独立复评先行，随后实现只读旧包/新包/磁盘比较，并在两种校验器中阻断大小写路径碰撞。该预览只证明能识别模板变更与用户改动，不写现有工作区；原位升级仍需事务恢复与单独授权。

2026-10-12 无滴答主链复评：已形成[单 owner 架构候选](../adr/0186-client-owned-feishu-matter-runtime-candidate.md)及[独立复评](feishu-matter-single-owner-review.md)。候选以 Client 单实例监督 DSH/Cordis durable runtime、内部 Matter 为真源；只放行离线契约/回放，不授权现行 consumer/provider 变更。`dida-optional-new-user` 与真实飞书首用继续保持未完成。

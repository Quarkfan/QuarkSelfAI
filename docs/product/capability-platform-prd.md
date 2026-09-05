# QuarkSelfAI 多用户能力与 Agent 编排平台 PRD

状态：`design-candidate / inactive`

版本：`2026-09-06.1`
真源配套：`config/capability-platform-migration.json`、`config/capability-platform-console-coverage.json`、ADR 0092 与独立 HTML POC。

## 1. 产品目标

QuarkSelfAI 从单机个人助手演进为“云端积累与编排、本地安全执行”的多用户能力平台。用户在云端控制台发现、组合、测试、发布和治理 Agent；每个用户安装本地客户端，由客户端发现 Claude Code、Codex 等可用执行器，并以 DSH 作为产品自带的保底执行器。Agent 的实际本机操作由客户端完成，云端不直接取得用户电脑控制权。

这里的“能力”不是工具调用的同义词，而是可安装、可组合、可验证、可回滚的 `Capability Artifact`。它可以表现为 Skill、知识、提示、工作流、MCP/API/数据库适配器、程序包、CLI、二进制、GitHub 项目、无头浏览器、容器、Notebook、沙箱、Web/桌面/数据应用、游戏、模拟器、交互体验、私有工作集成包，或由上述能力组成的 Agent 产品。

## 2. 成功结果

- 多用户、租户、成员、设备和客户端身份相互隔离。
- 云端持久化能力目录、Agent Blueprint、发布版本、授权策略和脱敏运行索引；本地持久化凭证、文件授权、执行器发现、工作区映射及敏感运行证据。
- 同一 Agent Blueprint 能在 Claude Code、Codex、DSH 上获得一致的标准上下文；能力声明与执行器实现解耦。
- 现有 QuarkSelfAI 能力全部获得唯一迁移处置，不因新架构重写而静默丢失。
- 安装、装载、授权、执行、产生外部写入是五个独立状态；发布不等于激活，激活不等于允许外部写入。
- 任一 source、provider、consumer、scheduler 或 write effect 在同一作用域只有一个有效 owner。
- 客户端离线时仍能运行已授权、已缓存且不依赖云端的 Agent；恢复联网后以幂等事件同步脱敏状态。

## 3. 非目标与硬边界

- 云端不保存本地绝对路径、凭证、完整消息正文、客户数据、公司内部标识或原始终端日志。
- 云端计划不是任意远程脚本下发；客户端只执行已解析、已签名、schema 合法并通过本地策略的声明式计划。
- 产品主线构建、启动和恢复不得依赖 BlackLake 工作区、公司仓库或私有 Work Integration Pack。
- 私有包只能实现公共 Capability SDK/ports，不得反向成为核心依赖。
- 当前设计不激活私有包、不改变 DSH/Cordis composition、不切消费者/provider、不产生外部写入、不删除主线来源、不重启服务。
- 不以“支持任意程序”为由绕过许可证、供应链、沙箱、数据范围和用户批准。

## 4. 核心抽象

### 4.1 Capability Artifact

每个能力制品必须声明：稳定 ID、类型、语义版本、来源 revision 与内容 digest、许可证和供应链证明；安装/启动/停止/升级/卸载/恢复生命周期；tools、ports、events、resources、UI、runtime、experience 接口；local/cloud/hybrid 放置；依赖与冲突；权限、effects 与数据范围；隔离、状态、备份与恢复；输入输出 schema；测试、replay、健康检查和回滚版本。

制品状态固定为：`catalogued → verified → installed → loaded → authorized → active`，任何一步都可停留或回退。`active` 仍不自动授予 write effect。

### 4.2 Agent Blueprint

Blueprint 是不可变、可版本化的编排声明，包含角色与目标、能力依赖、工作流与触发器、执行器策略、设备与工作区选择、权限/批准/effect、模型/预算/重试、通知、数据保留和回滚目标。草稿、测试、shadow、release 和 retire 是独立阶段。

### 4.3 Execution Envelope

三个执行器共享同一 envelope：tenant/user/device/agent/run/action ID，Blueprint 与能力 digest，最小上下文引用，工作区 grant，批准 grant，幂等键，预算与 deadline，数据分类，effect 范围和 continuation token。执行器不可把平台未声明的隐式上下文作为成功前提。

### 4.4 Capability Experience

应用、游戏和交互体验是一类有 UI 与会话生命周期的 Capability Artifact，而不是绕过治理的特殊应用。它可以请求本地 GPU、浏览器、文件或网络，但必须经过相同的安装、权限、隔离、运行、审计和恢复合同。

## 5. 目标架构

```text
Cloud Control Plane
  Identity/Tenant ─ Capability Registry ─ Agent Studio/Release
          │              │                       │
          └──── Policy/Approval/Plan ─ Run index/Audit
                              │ signed declarative plan
                              ▼
Local Client Runtime
  Device identity ─ Local policy ─ Capability runtime ─ Effect gateway
                         │               │                   │
                 Workspace grants   Executor broker      Local resources
                                      │
                         Claude Code / Codex / DSH fallback
```

依赖方向只有：Blueprint → 公共 Capability Contract；客户端/云端宿主 → 公共 contract；具体能力/私有包 → 实现公共 ports。公共 contract 不依赖任何具体能力或私有包。云端只请求有界 capability/effect，不直接调用操作系统。

## 6. 用户与关键流程

### 平台所有者

管理租户策略、制品信任源、全局预算、事故与审计；不能默认读取用户本机内容。

### 租户管理员

邀请成员、发布已验证能力和 Blueprint、限定权限上限、批准私有集成与回滚。

### Agent 构建者

从目录选择能力，在 Agent Studio 连接输入、工具、记忆、工作流和 effect，运行 contract/replay/shadow 测试后发布版本。

### 终端用户

安装客户端并登录；客户端自动发现执行器，显示发现依据和健康状态；用户为文件夹、应用、浏览器、网络和外部写入授予细粒度权限；运行 Agent 并可暂停、撤权、回滚或卸载。

## 7. 功能需求

控制台需求的规范化清单位于 `config/capability-platform-console-coverage.json`。每个 requirement 必须同时具有：可执行控制、当前状态/健康/风险监测、版本/权限/生命周期管理入口，以及 POC 中可定位的证据。缺少任何一项，覆盖率不得记为 100%。

功能域包括：总览、能力目录与供应链、Agent Studio 与发布、运行与工作流、设备与客户端、执行器路由、批准与 effects、权限与数据、租户与成员、集成与私有包、可观测性与事故、恢复与回滚、应用/游戏体验、审计与治理。

## 8. 现有能力迁移

`config/capability-platform-migration.json` 必须覆盖 `config/module-catalog.json` 的每个 module ID 且只出现一次。允许的处置只有：

- `platform-core`：不可卸载的最小公共 contract 或宿主安全内核。
- `capability-artifact`：可安装、版本化、授权、测试和回滚的通用能力。
- `private-work-integration`：只存在于私有包并实现公共 ports。
- `experience-artifact`：带交互界面的能力制品。
- `operations-capability`：审计、恢复、打包和治理能力。
- `migration-only`：有退出条件的兼容过渡资产。

混合模块必须先拆分：通用编排留在主线，BlackLake/客户/内部系统实现进入私有包；迁移前后通过 contract tests 和脱敏 replay 对比。

## 9. 执行器选择与失败语义

客户端发现本机 Claude Code、Codex 和 DSH，记录版本、能力声明、认证状态与健康，不上传凭证。Blueprint 可声明偏好，但本地 broker 根据能力匹配、授权、成本、连续性和健康选择。默认顺序可为 Claude Code → Codex → DSH，但明确绑定会话、provider 状态或工具语义的任务不得静默换执行器。失败切换必须复用 action/idempotency/session envelope，并生成可解释路由证据。

## 10. 安全、隐私与供应链

- 制品安装前验证来源、digest、签名、许可证、维护状态、已知风险、依赖锁和 SBOM；未验证制品只能进入隔离测试。
- native binary、容器、浏览器自动化、游戏和第三方项目分别声明文件、网络、进程、GPU、端口和持久状态权限。
- secret 只通过本地 secret reference 注入，云端仅知道引用是否可用。
- 审批绑定 tenant/user/device/agent/release/action/effect/scope/expiry，禁止宽泛长期授权隐式扩散。
- 云端审计保存结构化、脱敏事件；原始输出默认本地保留并受 retention policy 管理。
- 客户端和云端均强制单消费者、单 provider、单 scheduler、单 writer lease；失去 lease 时 fail closed。

## 11. 非功能要求

- 多租户行级隔离与租户级密钥域；跨租户缓存、日志和任务队列禁止复用未分区 key。
- 控制面暂时不可用不影响已授权离线运行；同步使用版本向量/幂等事件并显式处理冲突。
- 客户端升级支持 N/N-1 contract，能力制品可独立回滚；恢复默认 effects 关闭。
- 所有危险控制键盘可达、状态不只依赖颜色、默认热区不小于 44px，并支持 reduced motion、高对比和窄屏。
- 重要控制动作必须有预检、影响预览、确认、结果回读与可操作回滚。

## 12. 交付阶段与门禁

0. 真源与 POC：统一 PRD、现有模块迁移清单、控制台覆盖矩阵、独立 HTML POC、机器审计和浏览器复核。
1. Contract/SDK：Capability Manifest、Blueprint、Execution Envelope、plan signature、lease 与 effect contracts；默认不激活。
2. Client：设备注册、执行器发现、授权存储、能力沙箱、本地运行与离线队列。
3. Cloud：多租户身份、目录、Studio、发布、计划、run index、审计和策略。
4. 现有能力转换：逐模块 contract/replay，私有内容只在 Work Pack。
5. Shadow：同源观察、无 effect 对比，禁止双 consumer/provider/write。
6. Cutover：逐作用域 lease 交接，单写回读与回滚演练。
7. 退役：观察期结束后删除兼容资产和主线私有来源。

每阶段必须有独立 revision、文件范围、允许动作、排除项、测试、恢复和回滚；阶段 1 及以后凡改变 DSH/Cordis 核心边界、安装第三方代码、启用网络/凭证/effect 或切换 owner，均需精确批准。

## 13. 当前验收口径

当前“可以进入开发”的含义是：阶段 0 的文档与配置真源一致；迁移审计覆盖当前全部模块且无重复；控制台覆盖审计为 100%；HTML POC 的关键导航、Agent 编排、能力安装预检、设备/执行器、批准、运行、恢复和体验入口可交互；桌面与窄屏完成真实视觉复核；仓库既有文档/架构校验通过。它不等于运行架构已经批准或激活。

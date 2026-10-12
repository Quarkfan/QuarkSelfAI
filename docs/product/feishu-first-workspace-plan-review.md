# 飞书优先工作空间总计划复评

日期：2026-10-12
对象：`feishu-first-workspace-implementation-plan.md` 目标修订版
结论：**总体路线成立；本轮只放行只读取证、文档、静态契约、离线测试和不激活 starter。** 真实飞书配置、客户端身份、云服务变更、运行 composition、Dida 退出与旧 owner 切换未获本计划自动授权。

## 证据与适配判断

1. Owner 附件要求 QuarkSelfAI 承担多用户云端控制、本地执行、广义 Capability 和全部现有能力迁移。仓库已经有 PRD、ADR 0092、逐模块迁移矩阵和完成度审计，因此新增平行平台是错误方向；总计划复用原真源。
2. `config/capability-platform-completion.json` 仍为 `in-progress`，多租户、真实客户端、统一执行、等价迁移、主线去私有依赖和完整生命周期有 blocker。已验证的静态设计、inactive install 和 effects-off Cloud 不代表最终产品可用。
3. `config/product-composition.json` 的任务投影仍选用 Dida 模块，当前 compatibility Dida writer 仍在使用；“新用户无 Dida 可用”尚无运行证据。因此先定义可选契约和隔离验收，不能直接删模块或停现网投影。
4. `feishu-channel` 当前 active，其他原生飞书 effects/ingress 多为 inactive。飞书作为必选体验需要基于现有 `lark-cli` provider 补首用/身份/权限/接管证据，不能新造第二消费者。
5. `lark-shared` 当前规范要求 user/bot 显式区分，CLI JSON 成功依据 `ok=true` 或退出码 0；授权/高风险确认不能由安装器自动代替。计划中将这些设为安全门禁是必要的。
6. `github/agent-workspace-kit` 在目标修订前已有独立 Python 离线初始化原型，但没有 QuarkSelfAI 集成或飞书接入。把它标为 inactive starter 候选而非第二产品，能保护已做工作并避免双真源。
7. QuarkSelfAI 当前未提交 `package.json`、品牌客户端文件和 `.DS_Store` 属于保护集。总计划不吸收、不清理这些改动；后续所有代码提交按任务白名单审查。

## 风险、门禁和修正

| 风险 | 判断 | 放行条件 |
| --- | --- | --- |
| 飞书必选被误解为自动授权 | 高；初始化无法代表用户完成 scope 与 bot 配置 | 首用流程只读诊断、精确 scope 引导、用户完成授权；消费者另过单 owner 门禁 |
| Dida 去默认破坏现网 | 高；当前投影与维护仍在 composition/compat | 新用户无 Dida fixture 和启动证明；旧实例维持现有 writer，迁移后逐作用域切换 |
| 新 starter 成为第二运行时 | 中高；已有独立 CLI 原型 | 明确只生成本地 workspace/role bundle，不装第二 scheduler、approval 或 broker |
| 云端获取工作正文 | 高 | 签名声明式计划、客户端本地秘密与原始证据、脱敏投影和租户隔离测试 |
| “评测通过”冒充可运行 | 高；已有多项 inactive 证据 | 完成度审计保留 blocker；每形态区分 contract、install、auth、run、effect |
| 计划文本与机器清单漂移 | 中 | 扩展现有 catalog/completion audit，不平行复制迁移矩阵 |

## 本轮可实施范围与复评触发

现在可继续：完成只读基线审计、更新产品契约与配套手册、给 starter 做离线验证、加入不激活的飞书/Dida optionality 机器声明及其失败关闭测试。若下一步需要实际 CLI 授权、凭证、安装/执行新依赖、启动服务、改变 DSH/Cordis composition、provider/consumer/writer 或远端推送，必须先提交精确 revision、影响范围、回滚与新一轮批准。

下列发现会强制先修计划再复评：现有迁移矩阵不足以表达 channel optionality；starter 必须读取云端秘密或成为运行时；无 Dida 实例无法保留 matter 真源；飞书默认身份必须是 bot 而产品假设 user；以及任一现有运行 owner 发生变化。

## Monid 扩展计划复评（2026-10-12；实施前）

新增目标是借鉴 `https://monid.ai/SKILL.md` 的规模化按需发现，并把 Monid 能力纳入可选体系。官方 Skill `0.1.7` 采用 discover/inspect/run/poll 分层，且明确已有专用工具优先、Monid 用于缺口；官方集成文档提供 OAuth（用户自带账号/钱包）与代理（平台控制 endpoint、验证和计费）的选择。`run` 可能同步返回，也可能异步返回 run ID；`COMPLETED` 仅代表运行生命周期完成，仍须看 provider HTTP 状态和费用。来源与读取日期分别记录于 `docs/integrations/monid-candidate.md`。

独立判断：这种按需索引/检查 schema 的组织方式适合我们现有目录，但直接安装官方 Skill 会把可变远程内容和 `@latest` 全局 CLI 引入执行环境，并可能诱导付费调用、外部数据传输或新 effect。平台自己已有专用连接和 Capability Registry，不能新增第二个全局路由真源。OAuth 有用户自行承担费用的优势，却不天然提供租户级 endpoint 白名单；代理可加强过滤和预算，但带来运营、账单和秘密托管责任。当前许可证、CLI 依赖与数据处理条款未完成核验，不能批准真实集成。

评审结论：**通过总计划的分层发现机制及 Monid `catalogued / inactive` 候选，仅放行文档、受控静态元数据、无网络/无账单的离线门禁测试。** 不允许本轮安装 CLI、下载并激活 Skill、配置密钥、真实 discover/run、上传数据、购买余额或变更组合/消费者。后续 live 试点需单独批准明确账户/租户、endpoint allowlist、输入数据分类、接收方、单次/周期费用上限、effect、凭证存放、版本/digest、回滚和到期条件。Monid 不进入飞书首用必选链，也不影响当前个人实例。

复评触发：官方 API/价格/条款或 Skill 版本变化、许可证无法核验、需采用共享主密钥、第三方 endpoint 发生写入/电话/上传、供应商返回 hints 要求越权、或集成需要改变 DSH/Cordis/现有 provider 所有权时，先更新计划和本评审再实施。

## 本轮实施与回读（2026-10-12）

- 现有完成度审计新增 `feishu-first-new-user` 与 `dida-optional-new-user` 两个独立门禁，两项均保持 `incomplete`；审计退出码 2 是预期的“总目标尚未完成”，不是测试失败。
- PRD 明确飞书必选、Dida 非默认；首用手册把安装、身份、授权、消费者和写 effect 分开，并把无 Dida 新用户列为待完成的真实验收。
- 定向完成度测试通过；`npm run architecture:check` 报 151 个模块、0/23 个已激活 effect；在 Monid 扩展前完成的完整 `npm run check` 通过，主测试 572 pass、13 个因 sandbox listener 限制 skip，compat 测试 199 pass。
- 独立 starter 的两个 profile 在隔离临时目录初始化，5 项单测通过，Full 检查通过；它仍未整合 QuarkSelfAI，也未验证飞书首用。官方 Skill 快速校验器因本机 Python 缺 `yaml` 未运行，不能把自有检查冒充其结果。
- 本轮没有修改 `product-composition.json`、DSH profile、现网消费者/provider/writer、凭证、飞书授权、Dida 数据或服务。既有未提交 `package.json`、品牌客户端文件和 `.DS_Store` 保持在保护集外。

## Monid 扩展实施回读（2026-10-12）

- 新增 `config/external-capability-sources.json` 的唯一不激活候选及 `docs/integrations/monid-candidate.md`；PRD/README 已提供发现入口。未添加 runtime module、真实 endpoint、密钥或付费调用。
- 离线目录门禁测试与完成度测试合计 4/4 通过；`npm run architecture:check` 再次通过，151 模块、0/23 active effect。完整 `npm run check` 没有在这次文档/静态目录扩展后重跑，不能把之前的结果作为新增文件全量验证。
- 待办仍是许可证/条款、依赖供应链、具体 endpoint、预算、隐私接收方、真实租户隔离与 live 验证。上述门禁未闭合前仍保持 `catalogued-inactive`。

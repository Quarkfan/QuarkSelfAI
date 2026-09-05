# 辅助能力连续性与真源

本文件回答“恢复了数据库和账号以后，什么让新终端仍然是同一个助理”。机器清单位于
`config/assistant-continuity.json`；它只描述真源、恢复方式和待迁移边界，不保存消息正文、凭证或本机文件清单。

## 1. 四类真源

| 类别 | 权威位置 | 恢复方式 |
| --- | --- | --- |
| 协作与安全契约 | Git 中字节一致的 `AGENTS.md`、`CLAUDE.md` | clone 后由 Codex、Claude Code 和维护任务读取 |
| 架构与能力合同 | Git 中架构、ADR、需求追踪、模块目录和调度蓝图 | `npm ci` 后执行结构与恢复审计 |
| 运行连续性 | SQLite 或 PostgreSQL、DSH 状态、兼容期状态、能力进化账本 | 从 age 恢复包进入隔离 staging，再准备 restore-safe 实例 |
| 身份与秘密 | 账号重新登录或密码管理器 | 只读身份审计通过前不开放消费者或外部写入 |

Git、恢复包和密码管理器不能互相替代。聊天历史、模型缓存和整个用户配置目录也不能作为第四种隐式真源。

## 2. 本机目录只作为迁移输入

当前 Codex memory/Skill 与 Claude Code Skill 可能包含有价值经验，但其中也混有 session、插件缓存、遥测、设备路径和
工作上下文。默认恢复不复制整个目录；通用且脱敏的资产必须经过筛选、版本化和跨执行器验证后，才能进入主仓库或独立
个人能力包。未完成筛选不阻断核心 restore-safe，但必须作为能力覆盖缺口呈现，不能把“账号登录成功”等同于全部能力恢复。

2026-09-06 的首轮筛选记录在 `config/personal-capability-curation.json`：三个本机执行器 Skill 目录共观察到 75 份安装副本、
58 个不同名称，其中 28 个有供应商管理的可重装来源，10 个属于工作域迁移候选。当前没有任何用户目录 Skill 被核心运行
依赖，因此不选择文件进入主线或恢复包：供应商和通用能力按需重装，工作能力进入私有 pack，session、遥测、缓存和本机
memory 排除。以后只有某个本机 Skill 成为受支持核心 workflow 的必要依赖时，才重新触发逐项来源与内容评审。

Codex 周期任务的 host/project id 同样属于设备绑定。仓库只保存调度意图和规范化任务正文；新终端先创建暂停任务，
确认不存在第二个活动定义后，再由 owner 批准切换。

## 3. 工作集成边界

当前雇主相关适配器、知识、测试和历史规则仍由工作域隔离清单登记。在迁移完成前，它们继续服务现网，但不视为产品核心。
目标是进入单独、私有、版本化且可卸载的 work integration pack；主仓库在未安装该 pack 时仍须完成构建、恢复和核心启动。

迁移使用与产品仓库分离的私有 Git 远端。远端就绪不构成内容迁移或运行激活授权；仍只做清单、契约和无副作用脚手架，
不移动现网 provider、不改消费者、不形成双写。采用的通用设计必须去业务化后复制入主仓库，不能从私有工作包反向成为
核心启动依赖。

当前已创建并发布独立私有仓库 `QuarkSelfAI-Work`；GitHub 页面已确认 visibility 为 `Private`。远端 `main` 当前 revision
`3b9623bb31dca2e3991e6fec17fcb6d8411c7b85` 保存 99 个来源资产的逐项内容摘要、分类、计划动作和审阅依据，以及首批 20 个
非激活内容目标。候选结论仍为私有复制 21、主线泛化 64、脱敏回放 9、历史退休 5；首批精确批准覆盖 21 项处置，其中
实际落盘 20 项、排除 1 项、允许激活数为 0。审计确认未启用消费者或外部写入，且账本可从固定主线 revision 完整重建。
它现在是跨终端可取回的工作集成内容真源，但来源仍留在主线，host contract 和运行恢复尚未完成，所以不称为已经隔离。
首批内容迁移本身仍由 revision `971685b22476e6b1e263b20f441b5ea72519dcf2` 固定；较新的 revision 只修正审计按冻结
source revision 回读，避免主线治理文档演进被误报为首批内容漂移。

阶段 2 host contract 设计已固化在 ADR 0091、`docs/project/work-integration-host-contract.md` 和
`config/work-integration-host-contract-proposal.json`，状态为 `design-complete-awaiting-owner`。恢复顺序明确为先在无 pack、无
公司工作区和无公司网络条件下完成核心 restore-safe，再按精确私有 revision/digest 重建并安装 inactive pack；安装不会恢复
消费者、provider ownership、external write 或 takeover confirmation。设计完成不构成 DSH/Cordis 边界变更的实施授权。

digest 为 `6c2a8904b82c109a5c2d8f999ee2ddad315415605b21c0000041db327b95bff5` 的首批迁移已经 owner 批准并执行：
14 项按固定 source revision 原样复制，6 项重建为脱敏 contract replay，1 项因凭证形态字面量被排除。结果摘要为
`54e4ea05a735680361ca0cddb005890ef5fcad003df0e3eb2ae711addb3cb028`；内容、提案、结果账本和激活状态均由私有仓库审计。

## 4. 组织完成门禁

文档和数据组织只有同时满足以下条件才算完成：协作入口严格镜像；所有核心资料被 Git 跟踪；每项持久能力都映射到恢复
artifact；每个本机输入有保留、筛选或重建决定；工作域没有未分类资产；私有工作集成远端已选定；个人 Skill/知识完成
明确的纳入或淘汰决定。`npm run audit:assistant-continuity -- --strict` 只证明清单结构和已有映射一致，并会把仍待资源或
迁移的项目作为 `outstanding` 输出；它不把“盘点完成”冒充“隔离或异机恢复完成”。

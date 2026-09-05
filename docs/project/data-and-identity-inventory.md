# 数据与身份清单

盘点时间：2026-09-05。大小是当前本机快照，只用于容量设计，不是备份完成证明。机器可读策略见
`config/recovery-manifest.json`。

## 1. 必须恢复的权威状态

| 数据 | 当前位置 | 当前量级 | 敏感性 | 恢复策略 |
| --- | --- | ---: | --- | --- |
| QuarkSelfAI SQLite | `var/quarkselfai.sqlite3` + WAL/SHM | 约 420 KiB | 高 | 在线一致性快照；不直接复制活跃主文件 |
| DSH 正式 profile | `var/dsh` | 约 2.4 MiB | 高 | 筛选归档 profile、session/workspace 与 DSH 数据库；排除锁/缓存 |
| 兼容期 handoff 状态 | `var/handoff` | 约 9.3 MiB | 高 | 在兼容运行结束前归档；原生迁移完成后按 ADR 退出 |
| 运行环境与兼容配置 | `var/runtime.env`、`COMPAT_CONFIG_PATH` | 小于 20 KiB | 极高 | 仅加密备份；新机重写路径和新生成控制令牌 |
| 能力进化持久状态 | `var/capability-evolution` | 约 8 KiB | 中 | 备份脱敏账本与未决 proposal 关联，不备份消息正文 |

能力进化分为两类真源：调度意图和任务正文进入 Git；最近运行账本进入加密恢复包。本机 Codex automation 的 project id
属于设备绑定，不进入 Git 或恢复包；新终端登录 Codex 后按仓库蓝图重建为暂停任务，核验后再切换为唯一活动调度。

SQLite 和 DSH 目录中可能同时存在数据库/WAL，备份实现必须先取得一致性边界，不能把表中行数或目录打包成功当成
一致性证明。

当前 `scripts/recovery-bundle.ts` 已按 manifest 生成 SQLite online snapshot、PG custom dump 或筛选后的文件树，
并在离开临时目录前交给 `age` 加密；明文暂存始终在受限临时目录并于成功或失败后清理。恢复端只创建新的 staging，
验证内容寻址 manifest、文件哈希和 SQLite 完整性，不直接覆盖 live 状态。

PostgreSQL 备份额外记录不含凭证的 `server_version_num` 与精确 migration 清单。恢复只接受与 checkout revision 和
bundle ID 精确匹配的 staging，要求目标 major 不低于来源且没有用户关系；连接密码只进入 libpq 子进程环境和新 clone
权限 `0600` 的 restore-safe 配置，不进入 argv、receipt 或 Git。

## 2. 可重新登录或从秘密管理器恢复的身份

| 身份 | 当前事实 | 恢复方式 | 是否进入 Git |
| --- | --- | --- | --- |
| GitHub | 远端为 `git@github.com:Quarkfan/QuarkSelfAI.git` | 新机配置 GitHub SSH/登录并验证只读 fetch | 否 |
| 飞书 user | 当前账号为常东旭，2026-09-05 联网只读验证通过 | 运行 user OAuth 登录；scope 按能力最小化复核 | 否 |
| 飞书 bot app | 当前 bot 联网只读验证通过 | appId 可配置，appSecret 从密码管理器恢复 | 否 |
| 滴答 CLI | `~/.config/dida-cli/config.json` 当前仅含 `access_token` | 重新登录或从秘密管理器恢复 token | 否 |
| Codex | 本机账号与本地状态在 `~/.codex` | 优先重新登录；只筛选长期规则/Skill，不复制全部历史 | 否 |
| Claude Code | 本机配置和项目历史在 `~/.claude` | 优先重新登录；供应商 key 由秘密管理器注入 | 否 |
| 推理端点 | key 通过 `QUARK_INFERENCE_API_KEY` 注入 | 从密码管理器恢复；base URL/model 可用非秘密模板 | key 否 |
| age 恢复身份 | 本机 `0600` 运行副本；公钥在 `config/recovery-public.json` | 私钥手工保存到 Apple“密码”独立条目并在新机导出到临时受限文件 | 私钥否，公钥是 |

飞书配置实际位于 `~/.lark-cli/config.json`，可能由 macOS Keychain 保存秘密。Keychain 条目不能假定随 Git、文件归档
或 Time Machine 必然可用，恢复手册应支持重新登录/重新注入。

`scripts/audit-account-bootstrap.ts` 按 `config/account-bootstrap.json` 检查上述身份。默认只检查本地状态；`--online`
才执行 GitHub、飞书与滴答的只读调用。所有 CLI 输出只在进程内判断，最终报告不包含 token 片段、scope 或个人标识。

## 3. 应进入仓库或个人能力包的长期知识

- 产品架构、ADR、操作手册、默认策略与安全门禁：进入 QuarkSelfAI Git 主线。
- 通用、脱敏、可验证的个人协作 Skill：进入独立的 personal capability pack，并在主线记录精确版本。
- 当前 `~/.codex/memories`、`~/.codex/skills` 和 `~/.claude/skills` 只能作为迁移输入，不能继续作为唯一真源。
- 公司、客户、租户、人员、工单与内部代码知识进入对应工作 integration pack 或工作区私有知识库，不进入主线恢复包。

上述连续性资产的统一机器清单见 `config/assistant-continuity.json`。个人 Skill/知识首轮筛选已决定不把任何本机用户目录
作为核心恢复依赖；供应商与通用能力按需重装，工作能力迁入私有 pack，记录见 `config/personal-capability-curation.json`。
当前雇主工作集成仍处于“已盘点、未隔离”阶段，不能由账号登录或备份成功替代。

当前外部目录量级：`~/.codex` 约 4.6 GiB、`~/.claude` 约 850 MiB；其中大部分是 session、遥测、插件和缓存，
不属于最小恢复集。整目录复制会扩大隐私、供应链和版本兼容风险。

## 4. 可重建或必须丢弃

默认不备份：

- `node_modules`、`dist`、DSH validation profile、handoff rehearsal；
- stdout/stderr、重启日志、截图、`.DS_Store`、临时请求和锁文件；
- Codex/Claude session 全历史、遥测、缓存、下载的插件与模型缓存；
- Git 可重新生成的构建产物和容器镜像层。

DSH profile 内的 `node_modules` 与其中指向源码 checkout 的符号链接属于可重建依赖，真实演练已确认必须排除；它们
既不进入恢复包，也不能使恢复过程依赖当前 BlackLakeWork 的绝对路径。

日志如因事故需保留，应生成单独、脱敏、短保留期的诊断包，不能混入日常恢复包。

## 5. 数据所有权与删除

- 助手生成的事项、策略、审批、checkpoint 和工作账本由 QuarkSelfAI 数据库持有。
- 飞书、滴答、GitHub/Jira/GitLab 等外部系统仍是各自业务对象的权威真源，QuarkSelfAI 只保留必要引用和摘要。
- 备份删除遵循保留策略和密钥吊销；删除远端对象不能代替轮换已经泄露的凭证。
- BlackLake 专用数据在拆分前须先列明消费者、恢复需要和退出条件，不能为了“主线干净”直接清除在用状态。

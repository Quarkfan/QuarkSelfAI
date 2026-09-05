# 可移植与灾难恢复规范

## 1. 恢复模型

完整恢复由三个互相独立的输入组成：

1. **Git 仓库**：代码、锁文件、迁移、架构、文档、非秘密模板和恢复工具。
2. **加密恢复包**：QuarkSelfAI 数据库、DSH 持久状态、兼容期必要状态、策略/知识增量和经过筛选的配置。
3. **账号与秘密真源**：GitHub、飞书、滴答、Codex/Claude、推理端点以及备份加密私钥，由用户登录或密码管理器恢复。

缺少任一输入时，只能启动开发或只读诊断形态，不能声称恢复了助理能力。
账号恢复和脱敏验证的唯一手册见[账号恢复与只读验收](account-bootstrap.md)。

周期能力进化不是本机隐藏配置：仓库以 `config/capability-evolution-automation.json` 保存调度、执行器、标题和任务正文摘要，
任务正文位于 `docs/project/capability-evolution-task.md`。Codex automation 的 host/project 标识仍是设备相关外部状态，
恢复时必须重新绑定，并先保持暂停。

## 2. 目标恢复流程

```text
全新终端
  -> clone + checkout 已验证 revision
  -> 安装锁定 Node/npm/DSH 与外部 CLI
  -> 恢复秘密或重新登录账号
  -> 下载并校验加密恢复包
  -> 解密到临时、权限受限目录
  -> 恢复 SQLite/PG、DSH profile 和必要配置
  -> 以 consumer/write effects 关闭方式启动
  -> 执行恢复门禁与账号只读检查
  -> 确认旧消费者已停止并取得切换批准
  -> 启用唯一消费者和外部写插件
```

## 3. Git 层要求

仓库必须包含并验证：

- `package-lock.json`、DSH 版本基线和容器内冻结运行时；
- SQLite/PG migrations、配置模板、部署入口和架构目录；
- 根 `AGENTS.md` 与 `CLAUDE.md` 的同步协作契约；
- `config/recovery-manifest.json` 以及恢复审计脚本；
- 不依赖相邻 `BlackLakeWork` 或 `deepseek-harness` checkout 的正式安装路径。

开发期源码 DSH checkout 可用于兼容验证，但不得是恢复启动的唯一来源。发布演练应使用锁文件安装的 DSH 闭包。

## 4. 数据备份要求

### SQLite

- 使用 SQLite online backup API 或等价一致性快照；不能只复制正在写入的 `.sqlite3` 而忽略 WAL。
- 每个快照记录 schema version、Git revision、UTC 时间、SHA-256、字节数和 logical integrity check。
- 恢复到临时路径后先执行 `PRAGMA integrity_check` 和迁移兼容检查，再替换目标数据库。

### PostgreSQL

- 使用与服务端兼容的 `pg_dump --format=custom`，同时保存 PostgreSQL `server_version_num`、精确 migration 清单和校验摘要。
- 恢复到空数据库，执行迁移/结构检查和只读业务计数；不得直接覆盖未知现有实例。

### 文件状态

- DSH profile 与 session/workspace 状态采用文件级归档，但排除锁、临时文件和可重建缓存。
- `runtime.env`、兼容配置、飞书应用配置和滴答 CLI token 只能进入加密包；归档前后权限保持 `0600`。
- Codex/Claude 的完整 session、遥测、插件缓存和模型缓存默认不备份。需要保留的长期规则、Skill 和知识必须进入仓库
  或经过筛选的个人能力包，而不是依赖全目录恢复。

## 5. 加密与保留

- 恢复包在离开本机前必须使用 owner 控制的 age/X25519 接收者或等价端到端加密；私钥不与备份同处。
- 备份目标必须支持版本化或不可变对象；同机 `var/backups` 只允许作为临时 staging，不计入灾难恢复副本。
- 首版建议每日一次，保留最近 14 个日备份与 8 个周备份；数据库迁移、关键策略切换前额外生成事件快照。
- 备份成功以远端对象写入、下载回读、哈希一致和可解密清单为准，不以命令退出码单独判定。

### 5.1 当前本地命令

安装并配置 `age` 后，可以生成只含加密输出的恢复包：

```bash
npm run backup:recovery -- \
  --output /受限暂存目录/quarkselfai-YYYYMMDD.age \
  --recipient age1...
```

日常在线备份默认标记为 `online-bounded`，SQLite 使用 online backup，目录中的 SQLite 也逐个做一致性快照；锁、日志、
WAL/SHM、临时文件和完整会话历史被排除。用于迁移或关键切换的最终快照必须先按维护流程停止同一写入者，再增加
`--quiesced`，不能仅凭这个参数声称已经静默。`--include-optional` 会纳入筛选后的 Codex memory/Claude skill，默认关闭。

当前设备的非秘密 recipient 位于 `config/recovery-public.json`，设备相关目标和私钥路径位于 Git 忽略的
`var/recovery-target.json`。正式日备份使用：

```bash
npm run backup:publish
```

该命令只向 `daily/YYYY/MM/` 创建新对象，使用不可覆盖复制；随后重新读取目标对象，校验密文字节数和 SHA-256，
使用独立私钥解密到受限临时目录，核对内容寻址 bundle manifest 与 SQLite integrity，最后才写入不含业务正文和秘密的
`.receipt.json`。任一步失败会删除本次精确对象，且临时明文始终清理。

当前 macOS 主机还安装了独立的低优先级 LaunchAgent，每日本地时间 03:15 执行：

```bash
npm run backup:cycle
```

`backup:cycle` 先完成与 `backup:publish` 相同的不可覆盖写入、目标回读、真实解密和 SQLite 完整性校验，再按
14 日 + 8 周策略清理严格血缘的旧对象。它没有 `RunAtLoad` 或 `KeepAlive`，不启动 QuarkSelfAI、飞书消费者或任何
外部业务 effect；单次失败由 launchd 留在本地日志，下一日再运行。安装与回滚见[部署与运行](../operations/deployment.md)。

iCloud Drive 是首个 filesystem provider。上述成功只能证明“已写入并从本机 File Provider 挂载回读”，不能单独证明
Apple 云端已经同步，也不能代替另一设备下载演练。私钥运行副本位于本机受限目录，灾备副本应手工保存到 Apple
“密码”的独立条目；不得保存到同一个 iCloud Drive 恢复目录。

保留检查默认只生成计划：

```bash
npm run backup:prune
npm run backup:prune -- --apply
```

策略保留最近 14 个有备份的 UTC 日期各一份，并从更早日期保留最近 8 个 ISO 周各一份。只有 receipt 项目身份、对象
相对路径、bundle ID、密文字节数和 SHA-256 全部与实物一致的对象才进入清理计划；孤立、损坏或未知文件只报告为
`ignored`，不自动删除。`--apply` 只删除计划中的精确密文/receipt 对。

恢复只能先落到一个不存在的新目录：

```bash
npm run restore:stage -- \
  --input /受限目录/quarkselfai-YYYYMMDD.age \
  --output-directory /受限暂存目录/quarkselfai-restore \
  --identity-file /由密码管理器恢复的/age-identity.txt
```

该命令先解密、拒绝危险归档路径和符号链接，再验证内容寻址 manifest、每个文件的 SHA-256/大小以及 SQLite
`PRAGMA integrity_check`。成功只代表“恢复包可分阶段读取”，不会把文件写入 live `var`，也不会启动消费者。

新终端的推荐入口把上述 staging 与 restore-safe 准备合并为一个命令，并在成功或失败后删除它自己创建的临时明文目录：

```bash
npm run restore:bootstrap-safe -- \
  --input /受限目录/quarkselfai-YYYYMMDD.age \
  --identity-file /由密码管理器恢复的/age-identity.txt
```

该入口不安装依赖、不代替账号登录、不写入用户配置目录，也不启用消费者、DSH kernel 或外部 effect。需要独立检查或保留
staging 证据时仍使用上面的 `restore:stage` 与 `restore:prepare-safe` 两步入口。

在一个 checkout revision 与恢复包完全一致、且尚无 `var` 目录的新 clone 中准备安全实例：

```bash
npm run restore:prepare-safe -- \
  --staging-directory /受限暂存目录/quarkselfai-restore \
  --project-root "$PWD" \
  --web-port 13210
```

该步骤只支持当前默认 SQLite 形态；PostgreSQL 必须另走空数据库 `pg_restore` 门禁。生成的
`var/restore-safe.env` 强制 `ASSISTANT_RUNTIME=control-only`、`ASSISTANT_KERNEL=off`、
`TAKEOVER_CONFIRMED=false`、`WORK_JOURNAL_ENABLED=false` 和 loopback 控制台，并生成新的本机控制令牌。原账号配置
只放入 `var/recovery-input` 等待重新登录或人工复核，不自动写回用户目录。需要只读查看时可运行：

```bash
npm run build
npm run start:restore-safe
```

这仍不是接管。恢复实例完成账号、工作区和数据只读验证，确认旧实例停止并取得 owner 对本次单写者切换的批准后，
才能使用正式部署流程生成新的运行配置。

PostgreSQL bundle 使用独立的空库恢复入口。连接串只能由批准的 secret store 注入环境变量，不能放在命令参数；
`--approved-bundle-id` 必须与已核验 bundle 精确一致：

```bash
npm run restore:prepare-postgres-safe -- \
  --staging-directory /受限暂存目录/quarkselfai-restore \
  --project-root "$PWD" \
  --approved-bundle-id /已核验的bundle-id/
```

执行前需已设置 `QUARK_RESTORE_POSTGRES_URL`。工具先确认目标 PostgreSQL major 不低于来源、目标库没有任何用户关系、
custom dump inventory 非空且 bundle migration 与 checkout 精确一致；然后以 `--single-transaction --exit-on-error`、
`--no-owner --no-privileges` 恢复，最后回读 migration 集与应用关系。数据库密码转为 libpq 环境变量，不进入
`pg_restore`/`psql` argv。成功后生成与 SQLite 相同的 `control-only`、loopback、`TAKEOVER_CONFIRMED=false`
配置；恢复后核验失败时不会自动 drop 数据库，而会明确要求检查或丢弃这个隔离目标。

## 6. 恢复安全门禁

恢复实例必须先处于 `restore-safe`：

- 飞书事件消费者关闭；
- 飞书、滴答、外联、发布等写 effects 关闭；
- 控制台只绑定 loopback，生成新的本机控制令牌；
- workspace allowlist 由新设备显式配置，不恢复旧设备绝对路径；
- 只读验证账号归属、数据库完整性、DSH profile、模型路由和时区；
- 检查旧实例/旧 consumer 已停止，并由 owner 批准接管。

任何一步失败都保持只读，不自动回退到另一套数据库或第二个消费者。

## 7. 验收矩阵

| 门禁 | 通过证据 |
| --- | --- |
| Clone | 新目录 clone 指定 revision，`npm ci` 与 build 成功 |
| 仓库完整 | `npm run architecture:check`、`npm run audit:recovery -- --strict` 通过 |
| 数据完整 | SQLite integrity/PG restore 检查、迁移版本和备份哈希一致 |
| 身份可用 | 飞书 user+bot、滴答、Codex/Claude/DSH 逐项只读检查，不输出 token |
| 控制台 | loopback 登录、健康与关键状态可见 |
| 连续性 | 未完成事项、审批、幂等 checkpoint、策略和最近能力进化状态可读取 |
| 能力进化 | 仓库蓝图严格审计通过，本机任务字段和 prompt 摘要一致，且只存在一个经批准的活动调度 |
| 单写者 | 旧实例停止，新实例唯一 consumer，重复消息/任务保护有效 |
| 外部效果 | 精确批准后依次放开，写后核验成功 |
| 回滚 | 新实例停止后旧 checkpoint 可恢复，不产生双写 |

## 8. 当前未完成项

截至 2026-09-06，加密打包、隔离校验与 fresh-clone `restore-safe` 准备核心已实现；最新 revision 已通过一次真实
`restore:bootstrap-safe` 冷 clone 演练，覆盖 `npm ci`、构建、解密、SQLite integrity、control-only 启动、健康回读、停止和
明文 staging 清理。真实 `age 1.3.2` 身份与 iCloud Drive filesystem provider 已完成 online-bounded 写入、挂载回读、
密文哈希、解密和 SQLite integrity 闭环，且每日
03:15 的本机调度已启用。owner 已确认 Apple“密码”私钥副本完成并决定继续使用当前身份；PostgreSQL custom dump
元数据与空库 restore-safe 门禁已实现并通过隔离假执行器测试，仍缺另一设备实际取出与下载、真实 PostgreSQL 空库演练和
全新终端接管演练。
因此当前能证明“当前设备可从远端代码与加密包重建可启动的安全实例”，不能证明“助理能力可在任意终端随时恢复”。
本轮固定证据见 [`docs/evidence/recovery-bootstrap-2026-09-06.md`](../evidence/recovery-bootstrap-2026-09-06.md)。

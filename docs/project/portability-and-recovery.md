# 可移植与灾难恢复规范

## 1. 恢复模型

完整恢复由三个互相独立的输入组成：

1. **Git 仓库**：代码、锁文件、迁移、架构、文档、非秘密模板和恢复工具。
2. **加密恢复包**：QuarkSelfAI 数据库、DSH 持久状态、兼容期必要状态、策略/知识增量和经过筛选的配置。
3. **账号与秘密真源**：GitHub、飞书、滴答、Codex/Claude、推理端点以及备份加密私钥，由用户登录或密码管理器恢复。

缺少任一输入时，只能启动开发或只读诊断形态，不能声称恢复了助理能力。

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

- 使用与服务端兼容的 `pg_dump --format=custom`，同时保存 PostgreSQL major、schema migration 和校验摘要。
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
| 单写者 | 旧实例停止，新实例唯一 consumer，重复消息/任务保护有效 |
| 外部效果 | 精确批准后依次放开，写后核验成功 |
| 回滚 | 新实例停止后旧 checkpoint 可恢复，不产生双写 |

## 8. 当前未完成项

截至 2026-09-05，备份目标、加密接收者、自动备份脚本、远端回读校验和全新终端演练均未完成；因此当前只能证明
“代码可 clone”，不能证明“助理能力可随时恢复”。

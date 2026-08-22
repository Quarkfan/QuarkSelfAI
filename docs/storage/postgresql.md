# SQLite 与 PostgreSQL 数据模型

存储由 `ASSISTANT_STORAGE` 选择，默认是 `sqlite`。飞书消息、滴答任务、Codex 任务侧栏和执行器 session 都不是数据库的替代品。

## 选择后端

```bash
# 默认；单机、本地和轻量服务器
ASSISTANT_STORAGE=sqlite
SQLITE_PATH=var/quarkselfai.sqlite3

# 多进程控制面、正式服务器或需要外部备份/高可用
ASSISTANT_STORAGE=postgres
DATABASE_URL=postgresql://user:password@host:5432/quarkselfai
```

SQLite 使用 WAL、外键和 5 秒 busy timeout，适合一个 QuarkSelfAI 实例。不得把 SQLite 文件放在不保证 POSIX 锁语义的网络文件系统上，也不得同时启动多个写实例。PostgreSQL 是服务器部署的推荐选项，但飞书单消费者约束仍然存在，数据库不能消除重复消费风险。

## 表职责

- `assistant_event`：规范化事件及完整原始 payload，通过 `deduplication_key` 幂等写入。
- `matter`：同一事项的长期聚合，保存可快速阅读的最新摘要。
- `action_record`：一次明确动作及当前状态；只允许一个实际 executor。
- `action_transition`：动作状态的追加式审计记录，使用业务幂等键避免重复执行。
- `approval_request`：跨重启、跨小时存在的正式批准，不依赖 DSH one-shot approval 内存状态。
- `projection_binding`：滴答任务、飞书卡片、Codex session 与内部 matter/action 的映射和内容指纹。
- `consumer_checkpoint`：事件消费者断线恢复所需 checkpoint。

## 初始化与迁移

程序启动会自动执行幂等的初始 migration。SQLite migration 位于 `migrations/sqlite/`，PostgreSQL migration 位于 `migrations/`。

生产环境应由部署系统提供 `DATABASE_URL`，不要把密码写入 Git。也可以预先执行 PostgreSQL migration：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_initial.sql
```

迁移必须先备份并在测试库验证。生产迁移和消费者切换是两个独立步骤，禁止边改表边让新旧消费者同时写同一投影。

## 数据边界

- `raw` 用于 schema 演进、问题复盘和脱敏回放，应配置保留周期和访问控制。
- 不保存飞书、滴答、Codex 或 Claude 的 token、cookie、私钥。
- 日志与通知不得输出 `DATABASE_URL`。
- 后续为消息内容增加分级保留、字段级脱敏和定期清理 job。

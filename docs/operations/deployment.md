# 部署与切换手册

## 组件

- 一个 DSH profile 和 QuarkSelfAI Bundle；
- 独立 PostgreSQL 数据库；
- `lark-cli` bot 身份事件消费者；
- Claude Code、Codex、DSH native executor providers；
- 飞书、滴答等投影插件。

## 发布顺序

1. 数据库备份并应用迁移。
2. 部署新代码但保持 event consumer 和外部写插件关闭。
3. 执行构建、契约、CLI compatibility 和数据库健康检查。
4. 开启只读影子处理，比较新旧系统决策。
5. 冻结旧 consumer checkpoint，确认新系统已加载 action ledger。
6. 优雅停止旧消费者，确认 server-side subscription 已释放。
7. 启动新消费者并等待每个 EventKey 的 ready marker。
8. 逐个启用投影和 executor；持续检查双写、重复任务和越权回复。

## 回滚

停止新消费者并确认退出后，从旧 checkpoint 恢复旧 bridge。数据库迁移默认向前兼容；没有经过单独审批不得执行破坏性回滚。事故期间保留原始事件和 action transition，使用补偿处理而非手工改历史。

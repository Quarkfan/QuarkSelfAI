# 无滴答内部 Matter 投影：第一批实施计划

状态：实施前评估通过；日期：2026-10-12。配套总计划见 [飞书优先实施计划](feishu-first-workspace-implementation-plan.md)。本批只建设隔离的本地客户端持久化真源，不挂载飞书消费者、Dida provider 或 effect handler，不修改当前个人实例的数据库。

## 缺口与目标

当前 `message-intake-native` 的任务分支需要 `assistant.task-projection.upsert-intake.v1`；唯一真实提供者是 Dida。旧 `matter` 表通过 `enqueueAction` 写入，该 API 会让 worker 执行 action，不能当作纯事项投影。目标是在新用户 Client 本地、现有设备身份作用域内建立一份不依赖 Dida 的 Matter 记录与飞书来源血缘，为后续单 provider 的 effect 实现提供安全存储端口。

## 第一批设计

1. 扩展现有 inactive Client SQLite schema，增加 `local_matter` 与 `local_matter_intake`。前者存 tenant/user、稳定 matter ID、来源指纹、标题、摘要、优先级、标签、到期时间和状态；后者存 idempotency key、请求摘要与结果 matter ID。所有行由已登记的本地身份限定，来源只存 SHA-256 指纹，不保存完整飞书消息、聊天 ID 或绝对路径。
2. 新增窄方法 `upsertIntakeMatter` 与 `intakeMatter`；在一个 SQLite transaction 中先核对幂等键与请求摘要，再插入或更新。相同 key/相同内容重试不重复写；相同 key/不同内容拒绝。不同 key/同源允许更新 open/waiting Matter，completed/ignored/superseded 不隐式重开。显式合并到另一个 Matter 暂不支持，必须失败关闭。
3. 本地 Matter ID 根据 tenant/user/来源指纹稳定生成，但所有读写仍按当前已登记身份过滤；持久行的 scope 不符即报错。云投影仍只输出脱敏计数，不上传标题、摘要、来源指纹或本地路径。状态与 Matter 细节仅本地读取。
4. 使用现有 Client 的 `001_client_state.sql` 建表，避免给当前个人实例的自动迁移目录追加 DDL。新代码仅通过 inactive Client API 显式调用，不挂入 runtime composition，也不声明 `providesEffects`；它不能单独满足无 Dida 完成度审计。

## 验证与退出

隔离临时数据库测试：首次写入、同 key 重试、冲突 key、同源更新、终态不重开、跨 scope 拒绝、关闭重开恢复、云投影无敏感正文、无 action worker/外部 effect。构建、架构检查和全量测试均通过后提交。后续批次另行设计 effect adapter、授权与单 provider composition、真实飞书无 Dida 冷启动及当前个人实例的单写迁移；在此之前 `dida-optional-new-user` 保持 incomplete。

# 无滴答内部 Matter 投影：第一批独立评估

日期：2026-10-12；对象：[第一批计划](internal-matter-projection-batch-1.md)；结论：**放行 inactive Client 本地存储、契约和隔离测试，不放行真实 effect provider、飞书消费者或数据迁移。**

证据：当前 `migrations/sqlite/001_initial.sql` 的 `matter` 表由现网 AssistantStore 使用，`enqueueAction` 会唤醒 worker；当前 `migrations/client-sqlite/001_client_state.sql` 属于尚未接管现网的 Client 本地状态，已带 tenant/user/device 唯一身份和云端脱敏投影。把新 Matter 写进 Client 状态，可避免启动时对现网个人 DB 自动执行 DDL，并保持每个设备的本地数据边界。

主要风险与门禁：同一用户多设备可能产生不同本地 Matter，第一批不声称跨设备同步或唯一 owner；真实启用前必须定义 tenant/user 单写租约、合并与恢复。来源指纹仅作幂等血缘，不允许用它代替用户/租户过滤。客户端 DB 未声明静态加密，因此只持久化完成任务所需的本地标题/摘要与有限元数据，云投影不得包含它们；磁盘加密和备份策略仍需产品级复核。旧 `matter` 与新本地 Matter 不得同时成为同一用户事项的 active writer；本批保持 inactive。

验收只证明存储原语和失败关闭，不把数据表存在误判为投影 effect 已接入、飞书首用已完成或 Dida 可拔除。若实现需要修改现网 AssistantStore、DSH/Cordis composition、启动服务、真实租户数据或外部写，先修计划与本评估后暂停当前批次。

## 第一批实施回读

在 Client 原有 SQLite schema 中新增本地 Matter 与幂等回执表；`SqliteInactiveClientStateV1` 增加限定 tenant/user 的写入和读取方法。写入不产生 action execution，云投影仍不含标题、摘要或来源 ID。定向测试覆盖首次写入、相同 key 重试、冲突拒绝、同源更新、跨 scope 拒绝、终态不重开、重启恢复和云投影脱敏。TypeScript build、架构检查及完整 `npm run check` 均通过；提交后的资产所有权仍需回读。尚未挂载 effect/provider 或改变产品组合。

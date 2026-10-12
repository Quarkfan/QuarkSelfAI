# Client 本地 Matter：无滴答首用的存储原语

状态：inactive；计划与风险见[第一批实施计划](../product/internal-matter-projection-batch-1.md)及[独立评估](../product/internal-matter-projection-batch-1-review.md)。这不是已启用的飞书任务投影，也不是 Dida 迁移说明。

新用户的 Client 在登记设备身份后，可在其本地 SQLite 状态中写入 Matter。写入必须带与已登记身份一致的 tenantId/userId、临时来源 ID、幂等键、标题、摘要、优先级和标签。来源 ID 与幂等键仅以 SHA-256 指纹持久化；标题/摘要仍是本地敏感数据，不能进入云投影、日志或跨租户读取。相同幂等键/相同内容重试返回原 Matter；相同键/不同内容失败。已完成等终态不隐式重开，显式合并到其他 Matter 暂不支持。

`SqliteInactiveClientStateV1.upsertIntakeMatter` 和 `intakeMatter` 是底层存储方法。前者在同一事务中写 Matter 与幂等回执，后者按已登记 tenant/user 精确读取。它们不会写入 `action_execution`、启动 worker、调用 Dida 或发送飞书消息。Client 发行包里的 `001_client_state.sql` 随版本固定并参与发行物摘要；本批未触碰现网 AssistantStore 的自动迁移目录。

业务调用应从持有实例租约的 `InactiveLocalClientApplicationV1.matterPort()` 获取窄端口，不直接另开 Client 数据库。Application 关闭后端口立即失效；第二个 Application 无法同时取得同一路径的 lease。这仍是同进程内部接口，不提供 HTTP/IPC/CLI，也未注册为 DSH workflow effect。下一步边界决策见[第二批计划](../product/internal-matter-projection-batch-2.md)。

当前限制：尚无飞书消息 effect adapter、跨设备单写租约/合并、任务完成/状态转换 API、UI 或正式恢复演练。一个用户若在多设备独立运行，不能把这些本地记录视为已同步的全局单一真源。当前个人实例仍由原链路负责；无 Dida 新用户验收及产品完成度均保持 incomplete。下一批必须先评估 effect 授权、唯一 provider 和单设备/跨设备归属，再考虑运行挂载。

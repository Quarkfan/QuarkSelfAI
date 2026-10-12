# Client Matter 端口：第二批独立评估

日期：2026-10-12；对象：[第二批计划](internal-matter-projection-batch-2.md)。结论：**放行同进程 inactive Client Application 的窄端口与隔离测试；不放行 DSH/Client 桥接或真实 Feishu effect。**

与第一批不同，当前阻断不仅是持久化，而是两种运行形态的所有权关系。Client 有进程实例租约、设备身份和本地秘密；DSH `message-intake-native` 的 effect handler 目前只认识 `quarkWorkflows`，没有一个经过验证的 Client Matter port。直接从 DSH 另开 SQLite 连接虽能通过本地单测，却会破坏已设立的唯一 Client owner 边界。保留 Dida provider 现状、先让 Client 自己暴露窄端口，是可逆且不引入第二写者的步骤。

风险：Application 对外暴露 Matter 方法会扩大同进程可调用面。因该 Application 当前 inactive、仅在显式初始化并获得 lease 后存在，本批限制为内部类型端口、不导出 HTTP/IPC/CLI、不注册 DSH service、不更改产品 composition；scope 在 Application 和 state 双层复核，关闭后拒绝。测试不能证明真实飞书到 Matter 链路或跨设备单写。任何下一步若要改变 DSH/Cordis 所有权、消费者或投影 provider，须先完成 ADR 与精确授权。

## 本批实施回读

`InactiveLocalClientApplicationV1.matterPort()` 仅在 Application 已打开、持有实例租约时返回本地端口；其每次读写再次检查 Application 未关闭，并由底层状态核验 tenant/user。测试验证同一 lease 阻止第二 Application、关闭后旧端口失效、重启后 Matter 可回读、跨租户读取被拒绝、运行快照不含 Matter 正文。定向测试 5/5，完整 `npm run check` 通过；提交后资产校验仍需回读。没有新增 DSH service、IPC、网络入口或消费者。

# 跨设备 Matter owner 第一批独立复评

状态：**有条件通过未挂载持久原语，不通过任何 live 接管**；2026-10-12。复评对象：[第一批计划](matter-owner-lease-batch-1.md)。

飞书接入选择的复评补充：`lark-cli` 应是专属应用和共享应用两种形态的默认通道。本批 Matter 租约不验证飞书 CLI 的全局订阅唯一性，也不能据此放行共享应用的多用户路由；首批专属本地 CLI 候选与将来的统一入口 CLI 候选必须分别验证。

已核对现有 `cp_device_session`：它按 `(tenant,device)` supersede session，不能约束同一用户的其他设备；Client `LocalClientInstanceLeaseV1` 也只在本机生效。控制面已存在可共用的 `cp_tenant/cp_user/cp_device` 身份关系与多连接 SQLite 事务，但当前 Cloud composition 的迁移集合是闭合的，故新 provider 必须独立、未挂载，不能暗中追加到当前运行数据库。

主要风险与审查结论：

- 租约到期不等于 Matter 状态已复制。禁止到期后无恢复证明自动转移；同一设备的续租仍须持有效 session，转移只能增加 epoch。旧 epoch 即使持本地数据也应被拒绝。
- 若恢复验证器在事务外异步执行，须在事务内再次比对 owner/epoch/expiry，消除检查到更新之间的竞争。两连接争用测试必须证明这一点。
- 释放不清空 owner 或 Matter，只缩短租约；转移回执必须只含摘要及 ID，不保存飞书正文、快照文件或密钥。
- 测试注入的 `verify: async()=>true` 不是正式批准；不得给它默认值、CLI/HTTP 可达入口或任何运行组合。后续接入时必须先审阅真实验证器和客户端在线验租协议。
- **写前在线验租与本地提交存在 TOCTOU**：暂停中的旧 Client 可能在云端 epoch 更换后完成本地提交。故本批只放行控制面排他与 epoch 单调性，不认定端到端单写。正式切换至少需要 Client 在 Matter 事务中标注 epoch、写后验收、旧 epoch 隔离/恢复演练；云端不得默认收集 Matter 正文来回避这一问题。

若实现要求改动现行 Cloud composition、服务器监听、客户端写路径、自动恢复或 DSH/Cordis 核心边界，本复评不放行，应先修订计划再评估。完成本批后，完成度审计中 `crossDeviceMatterFenceVerified`、`matterRecoveryVerified` 仍保持 false，因为缺少端到端证据。

实现后复核：新迁移只注册到独立未挂载 provider；没有默认可信恢复验证器、HTTP route、Client 绑定、live 消费者或外部 effect。离线竞争测试及完整 `npm run check` 通过。该结果维持“有条件通过未挂载原语”的结论，不上调跨设备或无滴答验收状态。

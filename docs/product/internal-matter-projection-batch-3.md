# 内部 Matter 投影：第三批离线 effect 边界

状态：独立复评后完成未挂载实现；2026-10-12。依据 [ADR 0186 候选](../adr/0186-client-owned-feishu-matter-runtime-candidate.md)；不改变其 Proposed 状态，也不执行单 owner 切换。

本批仅增加未注册、未挂载的 Client 本地适配器：消费现有 `upsert-intake` effect 的决策与来源，先要求一个由可信 Client 组合提供的**执行时授权检查端口**明确放行 tenant/user/来源/effect，然后通过已持 lease 的 `matterPort()` 写入并回读。授权证据与当前授权状态是两回事；不能仅凭 effect 内自报的 `grantedBy=owner` 判断授权仍有效。授权检查端口缺失、返回拒绝或抛错必须在写前失败关闭。

适配器拒绝非 `upsert-intake` effect、非 task 决策、显式旧滴答任务 ID、缺失来源/effect 幂等键、无效时间及跨 scope。内部 Matter 不继承滴答的 `projectId`、`dida.task-projection` 授权或外部写权限。保持现有 `assistant.task-projection.upsert-intake.v1` effect 字符串仅为离线语义映射；未来 profile 如何选择唯一 provider 和新 target 版本，另批决定，不能在本批注册 provider。

合成测试须覆盖：相同 effect 重放得到同一 Matter；不同内容复用同一键拒绝；跨 tenant/user、授权撤销/缺失、旧任务 ID、已关闭 Client 端口拒绝；写后回读；无 `DIDA_*`、无外部进程/网络、无 Feishu consumer。模块目录与迁移清单登记唯一源码 owner。完成仍不等于真实飞书首用、可选滴答或生产切换。

## 实施与验收记录

实现位于 `src/client-runtime/internal-matter-projection.ts`，没有 DSH effect 注册或运行 composition 挂载；唯一写入口为 Client `matterPort()`。新增 `test/internal-matter-projection.test.ts` 使用隔离 SQLite、真实 Client lease 和假授权端口做离线演练。`npm run check` 通过：153 个模块的架构检查、主仓测试及 bridge-compat 测试均通过；架构报告仍为 `effectsActive=0/23`。测试中的假授权端口并非正式授权真源，本批不支持 live 使用。

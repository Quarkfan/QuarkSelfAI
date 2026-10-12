# 飞书→内部 Matter 单 owner 候选独立复评

状态：**有条件通过离线研究与不激活实现；不通过运行切换**。2026-10-12。复评对象：[ADR 0186 候选](../adr/0186-client-owned-feishu-matter-runtime-candidate.md)。本评估不把 Proposed ADR 当作已批准架构。

## 独立核对

| 命题 | 当前证据 | 结论 |
| --- | --- | --- |
| 无滴答已经可用 | `config/product-composition.json` 必选 Dida 与 `DIDA_*`；`src/intake/plugin.ts` enabled 需要 taskProjection；`src/task-system/projection-plugin.ts` 是现有 effect provider | 否，不能先改 required 标志 |
| Client 已能接收 DSH 写入 | `local-client-application.ts` 的 `matterPort()` 仅限同进程；`installed-client-process.ts` 仅管理 no-effect worker | 否，缺监督运行时与 effect gateway |
| 可让 DSH 直连 SQLite | Client lease 及身份检查归 Client；第二批计划明确禁止直连 | 否 |
| 可在现网影子监听 | `feishu-native-ingress` 的 `startConsumer` 启动真实单 consumer；现有个人实例仍运行兼容 owner | 否，只允许离线 replay/recording fixture |

## 对候选 B 的挑战

同进程托管避免 IPC，但不自动保证单 owner：现有 installed process 的 `start()` 只启动 no-effect worker；DSH profile、event journal、workflow DB 与 Feishu consumer 的生命周期尚未并入它。`message-intake-native` 的投影契约也将 Dida project/grant 绑定到 task 分支；若直接复用会让“内部 Matter”继承错误授权语义。必须先证明：启动和关闭顺序、两个数据库故障边界、effect 注册唯一性、source checkpoint、租户隔离及重试幂等。不能把“同一进程”当作这些证明。

候选 A（Client 重写 workflow）会显著扩大语义复制及回滚成本，因此 B 可作为首选实验方向，但只在离线 evidence 后做最终决策。如果 DSH profile 无法被 Client 安全监督，回到 ADR 评估 A 或窄 IPC；不得为了进度改用 DSH 直连 Client DB。

## 放行与阻断

- 放行：只读生命周期调查、最小独立 contract、未挂载的 composition fixture、脱敏 replay、单 owner/授权/重启测试设计，以及手册更新。所有新增模块先登记唯一 owner，不能更改现行 consumer/provider。
- 阻断：安装或执行新的第三方依赖、启用真实 Feishu consumer、把内部 effect 注册进现行 DSH profile、修改现有个人实例 Dida writer、迁移 checkpoint/数据、切换服务或宣布无滴答完成。上述每项须按具体对象和验证/回滚点再获授权。
- 再评估触发：合同确定后发现必须新增 DSH/Cordis 核心语义、需要第二进程/IPC、投影授权无法与现有 workflow 向后兼容、恢复时可能丢/重复事件，或现有实例需要接管。先修 ADR 与计划，再实施。

## 下一批最小可执行验收

在全新隔离目录和假 Feishu 事件源中，只有一个 Client lease、一个事件 consumer、一个 workflow owner、一个内部投影 provider；不设置 `DIDA_*`。同一事件重复、乱序与重启后只出现一条 Matter，跨 tenant 和缺失授权拒绝，云端无正文，关闭 Client 后 effect 不可写。以上只是离线门槛；真实飞书首用与运行批准仍另计。

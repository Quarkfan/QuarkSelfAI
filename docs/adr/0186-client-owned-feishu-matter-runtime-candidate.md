# ADR 0186 候选：Client 单 owner 托管飞书摄取与内部 Matter 工作流

- 状态：Proposed / 仅适用于待核验的专属订阅与单主设备形态，未获运行边界切换批准；2026-10-12
- 范围：新用户无滴答冷启动。现有常东旭个人实例、兼容工作流及滴答投影不变。
- 依据：ADR 0092、0142、0185；`docs/product/internal-matter-projection-batch-2.md`；当前 `src/lark/ingress-plugin.ts`、`src/intake/plugin.ts`、`src/intake/workflow.ts`、`src/task-system/projection-plugin.ts`、`src/client-runtime/local-client-application.ts`、`config/product-composition.json`。

## 问题

当前 Client 的 Matter 端口由实例租约保护，但只是同进程、未激活的存储端口。飞书 consumer、事件 journal 与 durable workflow 由 DSH/Cordis 承载；`message-intake-native` 的 task 分支要求 `assistant.task-projection.upsert-intake.v1` 和投影授权，该 effect 当前仅有滴答 provider。`product-composition` 仍把滴答模块及 `DIDA_*` 作为必选。把配置标记为 optional，或让 DSH handler 直接打开 Client SQLite，都会在没有真实单 owner / 授权 / 幂等链路时伪称可用，后者还绕过 Client lease。

## 候选决策

新用户 profile 采用 **Client 作为实例与 effect gateway 的唯一 owner，在同一 Client 进程中监督一套 DSH/Cordis durable event + workflow runtime**。不是增加第二内核：DSH/Cordis 继续提供事件和工作流语义，Client 负责持有实例租约、设备身份、启停、provider 授权及本地 Matter 写入端口。既有 `feishu-native-ingress`/`message-intake-native` 只在这个被监督的实例中组合；每个 Feishu user/bot subscription 只能登记一个 consumer owner。客户端崩溃与恢复默认 consumer/effects off，完成身份、checkpoint、授权和 provider 检查后才可显式接管。

**新增的适用前提与待决问题：**两种产品形态都以 `lark-cli` 为默认飞书通道，不把浏览器或另写的 OpenAPI 客户端当成默认替代。首个候选是每用户专属应用/订阅，由本地 Client 托管唯一 `lark-cli` 事件消费者；第二形态是共享应用，由统一入口托管唯一 `lark-cli` 消费者，再按已验证身份路由。这里的“本地/服务端”只表示 CLI 所在位置与订阅 owner，不是两套飞书协议。`lark-cli` 的 `--as user/bot` 与本地 bus 只说明执行身份及本机进程协调，尚不能证明全局应用/订阅唯一或共享应用的多用户安全路由。共享形态的订阅 scope、tenant/user 映射和原始消息隐私边界须另行验证与决策；验证前不能让每个 Client 各自启动同一事件 stream。专属形态同样须从已验证身份取得不可伪造的 subscription scope，并在所有设备间取得该 scope 的租约。不得以 userId、bot 字样或进程内 `streams.size` 推断订阅唯一性。

本地 `local_matter` 只能证明单设备租约与幂等，不能证明同一用户多设备的全局 Matter 真源。首版若采用单主设备，须为 `(tenant,user,matter namespace)` 建立跨设备有期限、带 fencing epoch 的唯一 owner；旧设备失联、租约过期或恢复后都必须在写前复核 epoch，不能只凭本机 lock。主设备更换还需要可验证的加密状态恢复/交接和旧 writer 停止证明；未具备时只允许原设备恢复，不允许第二设备从空库接管并生成平行 Matter。多活/跨设备合并不在本候选范围内。

内部 Matter/Action 是新用户任务真源；滴答、其他任务软件只是可选、单独授权的投影。新增受控的内部投影 provider，不把 `dida.task-projection` grant 或 `projectId` 伪装为内部授权。新 target/授权契约须明确 tenant、user、matter scope、来源、有效时间与撤销；每个 effect 有稳定事件 ID 和幂等键，由唯一 Client Matter 端口在同一事务内去重、写入、回读。对未知/模糊事项、跨租户、过期/缺失授权、未确认的外部写一律失败关闭。现有 Dida provider 与个人实例不变；同一 profile、同一 effect kind 在任一时刻只能选择一个 provider。

## 为什么暂不选另外两条路

1. Client 全量重写事件 journal 与 durable workflow，再把 DSH 仅当推理执行器：长期可能更干净，但会复制已有重试、checkpoint、effect 投递语义，并在迁移期扩大双 consumer 风险。除非同进程托管证据证明不可维护，暂不重写。
2. 独立 DSH 进程经 IPC 调用 Client Matter：可以隔离故障，却需要认证、租约失效、重试和写后确认协议；当前只有进程内端口。首个可用版本优先用同进程托管，避免过早引入第二授权/写入口。未来需要进程隔离时另立 ADR 与协议。

## 不变量与切换门禁

- Client 唯一持有本地 DB/实例租约；DSH workflow 不直接打开 Client DB，不接触设备密钥；云端仅见脱敏投影。
- 同一身份下只有一个 Feishu consumer、事件 journal、workflow owner、同类 effect provider 和 Matter writer；不得用“影子”名义同时订阅 live 事件。
- 飞书订阅所有权按已验证应用/订阅身份而非仅 tenant/user 判断；Matter 写入所有权按 tenant/user/namespace 与 fencing epoch 判断。设备 session 的现有唯一性只覆盖同一 deviceId，不可冒充上述两种租约。
- 事件 journal、workflow 投递和 Matter 写入使用稳定 source/event/effect 标识，崩溃重试必须得到同一 Matter。跨租户来源在入口与写端双重拒绝。
- 投影授权是持久证据、执行时复核；内部写与飞书通知、滴答写分开审批。没有滴答或飞书授权时有明确的安全降级状态，不默默启用替代后端。
- 旧个人实例继续按既有兼容 owner 工作；新 profile 不能自动接管它的订阅、checkpoint 或 Dida 数据。

## 分批验证与回滚

0. 先固定本 ADR、产品计划和独立复评；两种形态均保留，以专属应用的本地 `lark-cli` consumer 为首个候选，核对真实应用/订阅身份、DSH profile 生命周期、端口/服务注册与用户身份作用域，列出不可共存的 owner 清单。共享应用分支须另评估统一入口的 `lark-cli` consumer、安全路由与隐私边界；不能把它当成已验证实现。
1. 仅构建未挂载的 composition/契约与 recording sink；合成/脱敏 replay 证明无滴答启动、单 provider、授权隔离、重复/乱序/重启幂等、拒绝跨 tenant、无正文云投影。不能用 mock“成功”代替 live 首用。
2. 在隔离新用户 profile 中演练 Client 持本机与跨设备 fenced 租约→启动被监督 DSH→飞书事件→durable workflow→内部 Matter→回读；失联与崩溃后默认 effects off。验证用户与 bot 身份、实际订阅 scope、旧 epoch 拒绝、双设备竞争、主设备恢复/交接和失败回退。
3. 再提交精确运行切换批准单：目标身份/profile、来源 checkpoint、旧/新 owner、effect provider、时间窗口、外部写范围、回滚点。先停旧 owner 并确认释放，再启新 owner；监测不得双消费/双写。个人实例另批批准，不被新用户验证覆盖。

每一批失败即维持或回到 inactive profile，保留可重放 journal/checkpoint；不得以清空 Matter/滴答数据回滚。只有真实飞书首用、无滴答冷启动、恢复与权限证明全部通过，才能更新 completion audit 与 `DIDA_*` 必选项。

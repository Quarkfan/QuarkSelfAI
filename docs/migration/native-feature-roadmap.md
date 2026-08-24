# Compatibility 功能原生化路线

机器真源：`config/native-migration-plan.json`。架构检查要求 11 个 `status=compat` 功能恰好落入一个迁移单元，
不能遗漏，也不能同时出现在两个切换单元中。

## 为什么不能直接删 bridge-compat

它现在同时拥有五条飞书订阅、滴答幂等指纹、待审批外联、小维回复关联、Codex session 生命周期和协作学习
样本。直接移动文件会造成双消费、漏处理、重复任务或重复外联。正确迁移单位是“状态所有权 + 消费者所有权”，
不是源文件目录。

## 六个迁移单元

| 构建顺序 | 单元 | 模块 | 生产切换前置 | 关键边界 |
| --- | --- | --- | --- | --- |
| 1 | collaboration-learning | 1 | message-intake-and-projection | 无业务写入，先验证 durable 样本与 cooldown 导入 |
| 2 | dida-maintenance | 1 | message-intake-and-projection | timer、超期指纹和完成清理 cursor 只能有一个 owner |
| 3 | session-lifecycle | 1 | message-intake-and-projection | 归档/删除不可重放，必须记录已经完成的外部动作 |
| 4 | xiaowei-research | 1 | message-intake-and-projection | 请求批准与慢回复 correlation 原子迁移 |
| 5 | delegated-followup | 1 | message-intake-and-projection | 待外联批准、工作日 checkpoint 和联系人结果原子迁移 |
| 6 | message-intake-and-projection | 6 | 无 | 五条飞书流、卡片回调、消息幂等和滴答投影整体切换 |

构建顺序按“先写低耦合功能、最后补齐底层通道”安排，便于提前测试；它绝不是生产切换顺序。生产切换必须按
`cutoverAfter` 拓扑执行：`message-intake-and-projection` 先取得底层通道和投影所有权，其余五个单元才可逐个
切换。每个单元都要完成 native 插件、迁移演练和 dry-run，对应维护窗口仍需常东旭明确批准。
`QUARK_NATIVE_FEISHU_INGRESS` 不能因为上层插件已经写好而提前在 compat 模式中生效。

### collaboration-learning 当前准备状态

- 原生插件已拆出脱敏观察、注意力分级、稳定模式评估与策略草案事件；compat 模式下强制禁用。
- 骨架新增通用 append-only signal 与 feature checkpoint，不含任何飞书联系人或协作对象语义。
- `npm run audit:collaboration-handoff` 只读检查旧样本、owner signals、候选策略和 cooldown，生成内容摘要指纹；
  它不导入、不启用策略、不发送卡片。
- 尚未迁移状态所有权。真正导入、接入审批卡片和启用 timer 仍是同一个维护窗口操作，不能拆开提前执行。

### dida-maintenance 当前准备状态

- 超期扫描与完成项清理已建成两个 durable workflow definitions；重启后从数据库 wake point 继续，不再依赖
  compat 私有 timer。
- 查询、删除和通知被表示为版本化 effect 契约。当前没有注册真实 Dida/飞书 effect handler，也没有创建生产
  workflow instance，因此不会发生任何外部读取、删除或提醒。
- 必须在 `message-intake-and-projection` 提供 task-system 与 notification handlers 并取得所有权后，才允许开启
  `QUARK_NATIVE_DIDA_MAINTENANCE`。

### session-lifecycle 当前准备状态

- 每个自动调研会话独立对应一个 durable workflow，明确记录待任务完成、归档、保留期等待、删除和完成状态；
  普通定时器不再直接拥有不可逆动作。
- Codex 状态检查、滴答完成检查、归档、删除和通知均为版本化 effect。删除 adapter 必须再次确认精确 UUID、
  会话未运行且仍处于归档状态；`missing` 只做幂等对账，`not-archived` 不删除。
- `npm run audit:session-lifecycle-handoff` 只读生成内容寻址交接，保留重试计数与游标但不迁移错误文本。
  当前没有 effect handler、没有生产 workflow instance，compat 模式下强制禁用。

### xiaowei-research 当前准备状态

- “已批准请求、发送、长时间等待、回复关联、通知、任务回写”已拆成 durable workflow；等待回复时不轮询、不占用
  模型会话，由 `message-intake-and-projection` 的单一飞书 owner 投递关联事件。
- `approvedAt` 是创建工作流的必填门禁；重试更换内部 effect id，但外部 idempotency key 保持不变，避免请求、
  通知或滴答更新重复执行。
- 旧状态交接保留必要的请求/回复业务材料和 correlation，剔除错误文本；当前仍未导入、未注册 effect handler、
  未向智造湖小维发送任何消息，compat 模式下强制禁用。

### delegated-followup 当前准备状态

- 工作日清单评估是一个单例 durable workflow；每个建议外联事项是独立 workflow，联系人失败不会阻塞其他任务。
- 联系人唯一匹配后仍必须生成持久交互批准；只有收到与 `approvalId` 精确对应的批准事件，才会产生
  `feishu.send-as-user` effect。发送正文固定声明“我是常东旭的 AI 分身”。
- 多联系人选择、补充搜索、发送、长时间等待回复、任务写回和结果通知均有明确状态；等待回复不依赖轮询 timer，
  由底层单一飞书消费者关联并投递事件。
- 交接保留旧卡片 requestId，保证维护窗口后未处理卡片仍可关联；当前未导入、未注册外部 handler，compat
  模式下强制禁用。

## 每个单元的统一完成证据

1. native 插件拥有独立 manifest、服务契约、生命周期和架构目录项；
2. 旧状态到 durable store 的内容寻址迁移可重复执行且不会覆盖新状态；
3. 影子比较无语义差异、无重复外部写入；
4. 切换前冻结 checkpoint，切换后证明只有一个 timer/consumer owner；
5. 回滚先停 native，再恢复未完成状态，已完成外部写入不重放；
6. 观察窗口通过后把模块从 `compat` 改为 `native`；迁移宿主退出条件全部满足后才删除代码。

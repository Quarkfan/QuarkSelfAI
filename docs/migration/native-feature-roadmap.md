# Compatibility 功能原生化路线

机器真源：`config/native-migration-plan.json`。架构检查要求 11 个 `status=compat` 功能恰好落入一个迁移单元，
不能遗漏，也不能同时出现在两个切换单元中。

## 为什么不能直接删 bridge-compat

它现在同时拥有五条飞书订阅、滴答幂等指纹、待审批外联、小维回复关联、Codex session 生命周期和协作学习
样本。直接移动文件会造成双消费、漏处理、重复任务或重复外联。正确迁移单位是“状态所有权 + 消费者所有权”，
不是源文件目录。

## 六个切换单元

| 顺序 | 单元 | 模块 | 关键边界 |
| --- | --- | --- | --- |
| 1 | collaboration-learning | 1 | 无业务写入，先验证 durable 样本与 cooldown 导入 |
| 2 | dida-maintenance | 1 | timer、超期指纹和完成清理 cursor 只能有一个 owner |
| 3 | session-lifecycle | 1 | 归档/删除不可重放，必须记录已经完成的外部动作 |
| 4 | xiaowei-research | 1 | 请求批准与慢回复 correlation 原子迁移 |
| 5 | delegated-followup | 1 | 待外联批准、工作日 checkpoint 和联系人结果原子迁移 |
| 6 | message-intake-and-projection | 6 | 五条飞书流、卡片回调、消息幂等和滴答投影最后整体切换 |

这里的顺序是风险顺序，不代表自动授权。每个单元都要先完成 native 插件、迁移演练和 dry-run，对应维护窗口
仍需常东旭明确批准。最后一个单元完成前，`QUARK_NATIVE_FEISHU_INGRESS` 不能在 compat 模式中生效。

### collaboration-learning 当前准备状态

- 原生插件已拆出脱敏观察、注意力分级、稳定模式评估与策略草案事件；compat 模式下强制禁用。
- 骨架新增通用 append-only signal 与 feature checkpoint，不含任何飞书联系人或协作对象语义。
- `npm run audit:collaboration-handoff` 只读检查旧样本、owner signals、候选策略和 cooldown，生成内容摘要指纹；
  它不导入、不启用策略、不发送卡片。
- 尚未迁移状态所有权。真正导入、接入审批卡片和启用 timer 仍是同一个维护窗口操作，不能拆开提前执行。

## 每个单元的统一完成证据

1. native 插件拥有独立 manifest、服务契约、生命周期和架构目录项；
2. 旧状态到 durable store 的内容寻址迁移可重复执行且不会覆盖新状态；
3. 影子比较无语义差异、无重复外部写入；
4. 切换前冻结 checkpoint，切换后证明只有一个 timer/consumer owner；
5. 回滚先停 native，再恢复未完成状态，已完成外部写入不重放；
6. 观察窗口通过后把模块从 `compat` 改为 `native`；迁移宿主退出条件全部满足后才删除代码。

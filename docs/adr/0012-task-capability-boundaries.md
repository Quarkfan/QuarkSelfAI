# ADR 0012: 任务存储、语义投影与维护策略分层

- 状态：Accepted
- 日期：2026-08-24

## 背景

旧 bridge 的 `DidaTaskCreator` 同时负责调用模型、判断是否新建或合并、生成标题摘要、读写滴答清单、工作日
跟进评估和结果回写。原生化初稿把这些能力都命名为 `task-system.*`，这会让 TickTick 适配器意外拥有助手的
业务判断。未来换成飞书任务或其他清单系统时，语义规则也会被迫重写。

## 决策

任务相关能力属于可替换的 feature contract，不进入通用骨架，并拆成四个命名空间：

1. `task-store.*` 只表达任务系统的读取与持久化能力，不进行消息价值判断或摘要改写；
2. `assistant.task-projection.*` 负责把已判断的信息幂等合并到任务中，拥有标题、标签、摘要和血缘语义；
3. `assistant.followup.*` 负责基于上下文、策略和模型给出跟进建议，不由任务存储适配器实现；
4. `task-maintenance.*` 表达有明确 owner 授权、保留期和批量上限的生命周期操作。

工作流依赖最窄的能力：会话清理只依赖完成状态查询；超期监控依赖任务查询；消息入口和小维结果依赖语义
投影；工作日跟进依赖语义评估。滴答适配器目前只提供其真实实现的读取与维护效果。未实现的语义 provider
继续在模块目录中显示为缺口，不得用一个“大而全”的滴答类伪装成已完成。

## 骨架与功能边界

- workflow runtime、effect outbox、授权证据、存储端口和模块目录是骨架；
- 任务系统端口、滴答适配器、跟进评估、消息到任务的投影都是骨架上生长的功能；
- 更换任务产品只替换 `task-store` provider；更换模型或协作策略只替换 reasoning/projection provider。

## 兼容性

这些原生 workflow 仍为 `runtime=inactive`，生产 owner 仍是 bridge compat，因此本次重命名不会改变线上消费或
写入。维护窗口前需实现 projection/reasoning provider、完成状态交接和影子审计，再整体切换对应 effect id。

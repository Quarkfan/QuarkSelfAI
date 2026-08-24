# ADR 0030：存储 Provider 聚合与消费端能力端口分离

状态：Accepted（2026-08-24）

## 问题

原 `AssistantStore` 同时暴露连接生命周期、事件日志、工作流、action、policy 和控制台读模型。即使一个组件只需
两个方法，也会依赖完整接口。后续增加业务持久化时，这个总线式接口会把功能变化扩散到骨架和无关消费者。

## 决策

- 按持久化职责定义 `StorageLifecyclePort`、`EventJournalStorePort`、`SignalStorePort`、
  `FeatureCheckpointStorePort`、`WorkflowStorePort`、`ActionStorePort`、`PolicyStorePort` 和
  `ControlReadStorePort`。
- `AssistantStore` 仅作为具体数据库 provider 必须完整实现的组合契约。
- 具体 `StorageConfig` 归 provider 功能层；骨架只把 `kind` 视为开放 provider 标识，不枚举数据库产品。
- 公共 `platform` 入口只导出 `storage/ports` 的有意扩展面，不整包导出 provider 内部类型。
- 应用 host、控制台、policy authoring、worker 和其他消费者必须声明最小能力端口，不得依赖组合契约。
- `DurableStatePort` 由 DSH 所需的持久化能力组合而成，但不暴露数据库 migration、close 或控制台读模型。
- 架构检查禁止 storage provider 边界之外引用 `AssistantStore`。

## 后果

- 新增功能通常只新增自己的 feature port 或复用通用 checkpoint/workflow，不扩大所有消费者的类型权限。
- SQLite 与 PostgreSQL 仍实现同一个完整 provider 契约，数据库选择和既有 schema 不变。
- 这次变更只收紧编译期依赖，不迁移数据、不切换状态所有者，也不改变运行时行为。

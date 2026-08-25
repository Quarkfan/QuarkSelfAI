# ADR 0025：存储端口属于骨架，数据库与连接 Host 属于 Provider

状态：accepted

## 背景

模块目录曾把 SQLite、PostgreSQL 和 `quark-durable-state` 全部标成 active skeleton。实际部署只选择一个数据库，
而应用骨架和 DSH runtime 又直接 import 两种具体实现。这既把“可用实现”误报成“正在运行”，也使替换数据库
必须修改骨架。

## 决策

1. `storage-port` 与新的 `durable-state-contract` 是 skeleton；前者定义持久化语义，后者定义 DSH 插件可见的
   持久化能力面。最初实现为聚合 `quarkState`，后由 ADR 0072 拆成窄 capability，数据库 provider 分类不变。
2. SQLite、PostgreSQL 和负责迁移/关闭连接的 `quark-durable-state` 都是 infrastructure feature provider。
3. application composition 不再创建数据库，只接收一个已构造的 `AssistantStore`。当前 compat composition 负责
   选择与现网配置相同的 provider，未来 native/server composition 可独立替换。
4. ledger、workflow、event runtime 和业务插件只 import `durable-state-contract`，不得依赖 connection host。
5. 当前本地运行事实记录为 SQLite active、PostgreSQL inactive；这不影响二者都处于 implementation ready。

## 结果

数据库选择不再是骨架依赖。现有 SQLite 路径、PostgreSQL 配置、迁移目录、Cordis plugin id 和运行开关均未改变；
本次只是依赖反转，不执行迁移、不打开连接，也不切换生产所有权。

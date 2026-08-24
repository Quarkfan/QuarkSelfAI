# ADR-0008: 骨架使用开放的通道与执行器标识

## 决策

领域骨架把 channel 与 executor 视为插件提供的字符串标识，不维护飞书、Claude、Codex 或 DSH native 枚举。
执行器路由、读写 provider 与基础设施故障 fallback 全部由 composition config 声明。事件日志持久化规范化
`kind`，存储层不得根据飞书 EventKey 反推领域类型。

## 原因

封闭枚举会让新增邮件、企业微信、其他 harness 或模型 provider 必须修改领域契约、数据库约束和路由内核，
把功能扩展变成内核发布。开放标识仍由具体 adapter 在注册时验证，安全边界由 workspace、approval、lease 和
idempotency 提供，不依赖 provider 名字。

## 兼容与迁移

- `007_open_adapter_ids.sql` 删除历史 executor CHECK，并保留全部 action/execution 数据。
- `008_event_kind.sql` 为历史事件回填通用 `kind`；后续事件直接写入 adapter 已规范化的值。
- 现有 `claude-code -> codex` 顺序仍由 `cordis.patch.yml` 显式配置，行为不变。

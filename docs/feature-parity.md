# 现网能力迁移与接管门禁

机器可读真源是 `config/feature-parity.json`，Web 控制台直接读取它计算 `takeoverReady`。任何必要能力为
`partial` 或 `missing` 时，禁止停止旧 bridge 或启动会抢占 `card.action.trigger` 的新消费者。

截至 2026-08-22，新系统已完成 DSH/lark-cli 适配、SQLite/PostgreSQL 持久化、只读控制台，并把
旧实现及 99 项契约测试收敛为默认关闭的兼容 Provider。它证明代码能力已经可携带，不代表生产接管完成；
以下现网能力仍缺少脱敏回放或受控运行演练证据：

- 滴答任务事项级合并、类型校验和当前摘要的当前 schema 结果回放；
- BlackLake 能力路由和调研决策的 DSH action 演练；
- 完整影子协作评估窗口。

Linux/容器是可选服务器发布形态，不再作为本地个人助手接管的硬门禁；其实镜像构建仍保持 partial，
服务器发布前必须补验。

因此当前结论是：**不满足接管条件，旧 `codex-lark-bridge` 必须继续运行。**

完成一项迁移时必须同时补实现、测试、回放证据和运行手册，再修改 manifest；禁止只改状态字段。

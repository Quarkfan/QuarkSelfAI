# 现网能力迁移与接管门禁

这里的 `status=complete` 只表示当前运行路径具备该业务能力，可能仍由 compatibility provider 承载；它不代表
DSH-native 所有权已经完成。控制台同时计算 `nativeCutoverReady`：只有所有必需业务能力 complete，且模块目录中
所有 required effect 已实现且 active，并且不存在 `runtime=compat|inactive|shadow` 的 feature，才允许把兼容层
视为可退出。两个门禁不得互相替代。

机器可读真源是 `config/feature-parity.json`，Web 控制台直接读取它计算 `takeoverReady`。默认情况下，任何
必要能力为 `partial` 或 `missing` 都会阻断切换；ADR 0004 允许 owner 精确接受当前全部已知证据缺口，
但不会改变 manifest 的真实状态，也不会自动接受以后新增的 incomplete。

截至 2026-08-22，新系统已完成 DSH/lark-cli 适配、SQLite/PostgreSQL 持久化、只读控制台，并把
旧实现及 99 项契约测试收敛为默认关闭的兼容 Provider。它证明代码能力已经可携带，不代表生产接管完成；
以下现网能力仍缺少脱敏回放或受控运行演练证据：

- 滴答任务事项级合并、类型校验和当前摘要的当前 schema 结果回放；
- BlackLake 能力路由和调研决策的 DSH action 演练；
- 完整影子协作评估窗口。

Linux/容器是可选服务器发布形态，不再作为本地个人助手接管的硬门禁；其实镜像构建仍保持 partial，
服务器发布前必须补验。

2026-08-23 常东旭明确要求立即切换并在运行中继续迭代，同时要求保持架构完整。系统以 accepted-risk
cutover 接管：旧 LaunchAgent 已停止，QuarkSelfAI/DSH/compat worker 成为唯一消费者；`dida-projection`
和 `shadow-collaboration` 继续显示 partial，直到真实证据自然补齐。

完成一项迁移时必须同时补实现、测试、回放证据和运行手册，再修改 manifest；禁止只改状态字段。

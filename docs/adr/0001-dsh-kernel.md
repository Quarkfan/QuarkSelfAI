# ADR-0001：采用 DSH 作为运行时内核

状态：Accepted（2026-08-22）

## 决策

重建助手，以 DeepSeek Harness 的 profile/bundle/plugin 模型作为运行时内核。`lark-cli`、滴答、
Claude Code、Codex、BlackLake harness 都是可替换的 capability/executor provider，不自建第二套内核。

DSH 当前处于 developer preview，因此固定基线为 `0.1.1-rc.2`，升级通过兼容报告、契约测试、
历史消息回放和影子运行，而不是直接跟随 latest。

## 原因

- Cordis 插件边界能隔离快速变化的外部 CLI；
- DSH 已提供 session、event、approval、job、persistence 和多 executor 扩展缝；
- 追加式事件与投影模型适合去重、迟到消息、审批和长等待；
- profile/bundle 允许用户配置覆盖而不 fork 内核。

## 约束

- 现网 bridge 在新系统通过切换门禁前继续运行；
- DSH one-shot approval 不能代替跨小时/跨天的业务审批，仍需 durable action ledger；
- DSH、lark-cli 的升级必须各自独立验证和回滚。
- 正式守护进程必须监管并健康检查 DSH profile；`ASSISTANT_KERNEL=off` 只用于测试和故障诊断，不能作为
  生产接管配置。
- 本地文件访问由 DSH session cwd 与 QuarkSelfAI workspace allowlist 双重收窄；服务器模式不得继承或
  挂载个人电脑主目录。

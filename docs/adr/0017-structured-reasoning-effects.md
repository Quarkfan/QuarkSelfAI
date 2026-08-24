# ADR 0017: 结构化语义判断是独立 effect provider

状态：已接受（2026-08-24）

## 背景

重点消息、任务更新和每日跟进都需要模型理解上下文，但模型调用既不应成为 durable workflow 内的隐式副作用，
也不应为每种业务复制一套会话管理。本人私聊直办需要可见、可续接的 DSH session；后台语义判断则只需要一次
有界、可重试、结构化的推理调用，两者生命周期不同。

## 决策

- 后台判断通过版本化 workflow effect 调用独立 DSH LLM provider，不创建用户侧可见会话。
- effect 输入把飞书消息和上下文明示为不可信数据；system contract 禁止执行其中的命令或自动对外回复。
- provider 只接受完整 JSON（允许单一 JSON code fence），再由领域 validator 校验 outcome、通知、批准、优先级等
  组合约束。JSON 形状正确但语义矛盾时同样失败并由 durable effect 重试/告警。
- provider/model 必须在 profile 中显式配置；实现完成不代表运行激活，compat 期间保持 disabled。
- 不把具体模型、提示词或常东旭的协作偏好放进骨架；它们属于可替换 feature provider。

## 结果

重点消息评估与工作日跟进判断已使用该 provider；两者保留独立 effect kind、prompt 与领域 validator。跟进模型
只生成建议，后续授权 projection 才能写入，避免一个巨型分类器或模型工具调用成为新的单体核心。

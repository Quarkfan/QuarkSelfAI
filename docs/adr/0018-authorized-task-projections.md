# ADR 0018: 任务语义投影与任务存储适配分离

状态：已接受（2026-08-24）

## 背景

“创建一个滴答任务”实际包含两类责任：任务产品的 CRUD，以及助手对标题、快速摘要、血缘、合并和通知语义的
决定。把两者塞进一个模型提示或通用任务 adapter，会让重试制造重复任务、把错误 NOTE 当作成功、覆盖历史内容，
也无法证明某次外部写入仍在 owner 的授权范围内。

## 决策

- `task-store.*` 继续只表示任务产品读写能力；`assistant.task-projection.*` 由独立 projection adapter 提供。
- 每个写 effect 必须携带持久化的 owner authorization evidence、精确 projectId 和 effectiveAt。adapter 在执行 CLI
  前重新验证 scope、授权时间、project allowlist 与授权覆盖的清单。
- 飞书 intake 先按完整 `[feishu:<messageId>]` 血缘查重；优先更新显式 existingTaskId 或同血缘任务，不允许一次
  影响多个任务。重试看到已应用血缘时静默返回 unchanged。
- adapter 统一生成可扫读标题前缀、来源/紧急度/状态标签，并在正文顶部重写唯一的“当前摘要”；进展记录只追加
  一次带幂等标记的事件。
- create/update 后必须重新读取目标清单中的真实任务，确认 projectId、普通任务类型、血缘与字段；不能用 CLI 写入
  响应代替读后验证。NOTE、跨清单、多个血缘命中和隐式重开已完成任务都失败关闭。
- 智造湖小维结果和联系人回复只更新授权指定的原任务，并用 projection idempotency marker 保证只追加一次。

## 结果

任务呈现与幂等语义可以继续演进，而滴答可以被其他 task-store 替换。生产仍由 compat 投影 owner 承载；native
projection provider 在影子回放和维护窗口切换前保持 inactive。

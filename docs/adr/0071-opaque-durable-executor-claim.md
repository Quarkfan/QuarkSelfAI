# ADR-0071：写执行器只接受不可伪造的 durable claim capability

状态：Accepted（2026-08-25）

## 问题

`SequentialExecutorRouter` 曾通过调用方提供的 `approvalGranted: boolean` 放行 workspace/external write。该布尔值在
durable worker 中确实来自数据库 claim，但 router 作为 Cordis Service 也可被其他插件直接调用；调用方传 `true`
即可绕过 durable action ledger。报错还写死“owner approval”，与授权骨架的开放 grantor 设计冲突。

SQLite/PostgreSQL provider 同时把拒绝原因写成 `owner rejected approval`。存储层不应解释当前个人助手的批准角色。

## 决策

- durable worker 在数据库成功 claim 后，为非只读请求签发一个进程内 opaque capability；
- capability 用 `WeakMap` 绑定 actionId、标题、prompt、workspace 与 mode，只能消费一次；伪造对象、修改请求或重放
  都在启动 executor provider 前失败；
- capability 签发函数是包内实现，不从 `./executor-router` 导出；架构门禁只允许 durable worker 调用签发入口；
- router 不再接收 `approvalGranted`，也不预设 grantor 身份，只要求“approved durable action claim”；
- storage provider 只记录 `approval approved/rejected`，当前由 owner 批准的产品语义留在发起 approval 的 feature。

## 结果

外部或动态插件不能仅凭一个布尔值直接启动写执行器。数据库 claim、worker lease、单次 capability、workspace 边界和
父 DSH session cwd 形成连续授权链；未来团队批准或其他 grantor 不需要修改 executor 骨架。

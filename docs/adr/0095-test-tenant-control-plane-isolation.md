# ADR 0095：测试租户控制面隔离内核

- 状态：Accepted for inactive implementation
- 日期：2026-09-06

## 决策

所有控制面记录都携带 tenant identity，仓储实现必须先选择 tenant partition，再执行用户、设备、Capability release、
Blueprint release、任务、结果或审计操作。相同 user/device/task ID 可安全存在于不同 tenant。普通成员只能看到自己的设备和
任务；owner/auditor 只能在当前 tenant 内读取脱敏审计，不存在平台管理员跨租户正文读取入口。

当前参考实现只接受 `test.*` tenant 和 `allowedEffects=[]`、`approvalGrants=[]` 的任务。任务派发绑定 tenant/user/device 与
签名计划 scope，并按 idempotency key 去重；结果只能保存 summary code、outcome 和 artifact digest，不保存本地正文、路径或
执行日志。

## 当前边界与回滚

实现为未挂载的内存 store，没有 listener、数据库、对象存储、队列、搜索、日志后端、客户端连接或生产租户。回滚提交即可。

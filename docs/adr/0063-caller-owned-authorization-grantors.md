# ADR-0063: Authorization grantor 由功能声明

状态：Accepted（2026-08-25）

## 背景

`DurableAuthorizationEvidence` 把 `grantedBy` 固定为 `owner`，校验函数也在骨架内强制 owner。这个规则适合当前个人助手，
却把产品角色写进 durable authorization contract；团队审批、发布控制器或未来插件必须修改 skeleton 才能接入。

## 决策

1. 骨架 evidence 的 `grantedBy` 改为非空开放字符串。
2. 调用方必须同时传入期望 `scope` 和 `grantedBy`；骨架只验证证据与调用方声明严格一致、授权时间不晚于生效时间，
   并继续校验 id、source 和正整数 revision。
3. 当前滴答投影/清理、Codex 调研会话生命周期等 feature 显式传入 `grantedBy: owner`，原安全边界不放宽。
4. 架构检查阻止 skeleton 重新硬编码 `grantedBy: owner`；测试证明非 owner grantor 可由其他功能安全使用。

## 后果

“谁有权批准”属于功能或部署策略，“证据如何持久、验证和重放”属于骨架。新增 grantor 不需要 schema 枚举或平台升级，
但任何 feature 忘记声明期望 grantor 都无法调用校验函数，因此不会退化成接受任意授权人。

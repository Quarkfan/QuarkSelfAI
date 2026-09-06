# ADR 0097：现有模块到 Capability Offer 的过渡

- 状态：Accepted for inactive implementation
- 日期：2026-09-06

## 决策

`module catalog` 的每个模块必须从机器迁移设计得到且只得到一个 Offer：平台核心绑定、通用 Capability Artifact 候选、私有
pack 引用或带退出条件的 migration tool。Offer 固定 `activationAllowed=false` 与 `currentOwnerPreserved=true`；缺少 Manifest
的能力标记 `manifest-pending`，不得冒充已可安装。

私有 work integration 的 Offer 不复制主线 source path；migration-only Offer 必须携带原退出条件。重复、漏项、未知模块、
非精确 revision 或启用 activation 的设计均失败关闭。

## 当前边界与回滚

Offer 只在内存编译，不写 registry、不发布 Manifest、不切换 owner。回滚提交即可。

# ADR-0061: Compatibility handoff 必须自包含审计证据

状态：Accepted（2026-08-25）

## 背景

旧 handoff 只复制 `state.json` 和生成后的 `config.json`。滴答 current-schema 严格审计依赖 `var/dida/**/result.json`
及原始修改时间；旧 bridge 目录删除后，即使 handoff state 完整，也无法独立复核投影数量、语义、重复和血缘。

## 决策

1. 交接准备器把旧 `var/dida` 作为必需输入，并递归复制所有普通文件；符号链接或其他特殊文件失败关闭。
2. handoff identity 同时包含状态、旧配置、执行器配置和 Dida 证据聚合哈希；任一证据变化都会创建新目录。
3. 每个证据文件保留修改时间，并生成 `evidence-manifest.json`，记录相对路径、字节数、SHA-256 和修改时间。
4. 目标文件继续使用 `wx`、`0600` 和同内容复用；同名异内容一律失败，不覆盖已有交接。
5. handoff 至少包含一份 `result.json`，避免空目录被误当成可重放证据。

## 后果

未来删除旧 bridge 前，可以只依赖内容寻址 handoff 重跑 state、shadow 和 Dida projection 严格审计。当前已缺失的
历史 Dida 文件不能由状态快照安全重建，因此仍是本次门禁的证据缺口；本决策只防止后续再次发生。

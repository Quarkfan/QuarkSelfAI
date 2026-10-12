# Workspace Starter bundle 只读接收

当前接口 `inspectWorkspaceStarterBundleBytes(raw, pin)` 只在本地验证字节，不读取相邻 `agent-workspace-kit` 源码、不写入工作区、不安装 Skill。`pin` 必须由调用方从可信的精确发布/签名计划取得 `sourceRevision` 和 `artifactDigest`；不得直接从 bundle 内部字段抄回当作 pin。返回值只有版本、角色、来源、摘要、文件数和 `inactive / executable=false / externalWritesEnabled=false`。

首批格式为 `agent-workspace-kit` 导出的规范 JSON：最多 2 MiB、64 个文件、单文件 128 KiB；只允许协作入口、工作区配置、角色指南、Markdown 文档、router Skill 与安全的 `.gitignore`/私有目录说明。校验器复算逐文件及整体 SHA-256，核对 Feishu 必选、`lark-cli` 默认、`host-runtime` readiness owner、无外部写和精确 pin。Skill 正文只作为不可信数据参与摘要，不进入返回值或模型上下文。

2026-10-12 离线跨语言回放：Python 来源提交 `cbec01c02949602c612b36202da904e6ad6508b1` 导出的 developer/product bundle，分别以摘要 `sha256:14942c693305778d74ff48606c95cbc9f337ea9d81c3e3ca09ee5748aabef240` 与 `sha256:534301513e25f44406d8ccb6e9dcebdc4780aecbfa913ef98af880e3993705e0` 通过 TypeScript 校验；两者各 15 文件。该证据只证明格式互通与内部完整性，不证明源身份、签名、租户授权或安装。离线测试、`npm run check` 也已通过。

不能把校验器接到现网 Client 的安装路径或从邻接仓库自动加载。下一批需先验证受信发布物、Capability Manifest、签名/来源、用户与租户 scope、workspace grant、安装/升级/卸载和用户数据保护；之后才能讨论把解包写入点接到 Client。现有 `InactiveArtifactStoreV1` 只保存未加载 blob，并不等于 Starter 内容已安装到用户工作区。飞书首用、Dida 非默认和成长晋级另有独立验收门禁。

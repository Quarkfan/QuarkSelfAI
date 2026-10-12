# Workspace Starter bundle 只读接收：独立复评

日期：2026-10-12。结论：放行纯 policy 校验器和离线回放，不放行安装、解包或运行时挂载。

直接依赖相邻 Python 源码会让产品在异机/容器失效，复制 seed 会制造第二模板真源；读取来源固定的规范 bundle 则符合可替换内容源边界。只读校验器应位于现有 capability governance policy 模块：它验证外部文件字节和预期身份，不拥有工作区写入、客户端租约、飞书消费、Skill 激活或云端权限，因此无需新增运行模块或 effect。

供应链风险仍在：Python bundle 的内部 digest 可被重新计算，不能代替签名或许可证审查。强制调用方提供预期 revision/digest 可阻断“只相信包内自述”，但预期值本身的可信来源须在后续受控发布批次证明。描述/Markdown/Skill 均作为不可信数据，当前接口只返回有界元数据。测试需同时证明格式兼容和负路径失败，不能用合成 fixture 单独宣称跨语言兼容。

剩余门禁：来源签名、Capability Artifact Manifest、租户/用户 scope、持久化安装状态、升级/卸载、宿主读取所选 Skill、Feishu 首用和无 Dida 运行均未完成。此批不改变 completion ledger 的 incomplete 项。

实施回读：合成单测覆盖精确 pin、inactive、路径/字节篡改和无正文输出；Python `cbec01c02949602c612b36202da904e6ad6508b1` 真正导出的双角色 bundle 均通过 TypeScript 只读验证，来源 revision 与各自摘要完全一致。`npm run check` 通过。证据详情见[操作手册](../operations/workspace-starter-bundle-intake.md)。

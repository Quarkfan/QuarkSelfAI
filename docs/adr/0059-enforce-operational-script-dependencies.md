# ADR-0059: 运维脚本进入真实依赖门禁

状态：Accepted（2026-08-25）

## 背景

此前 `scripts/*.{ts,mjs}` 只有唯一 owner 校验，跨模块相对 import 没有进入 `dependsOn`。这允许演练、安装和接管脚本
绕过源码分层：例如 policy 模块因演练脚本实际依赖 SQLite provider，兼容 profile 又直接复用长期产品 profile 的 helper。

## 决策

1. 架构检查把已跟踪的 TypeScript/MJS 运维脚本纳入跨 owner 相对 import 分析，并与模块 `dependsOn` 双向精确核对。
2. operations 层继续允许跨全部源码层，但它不是免登记区；脚本引用的每个 owner 都必须成为显式依赖。
3. `policy-rehearsal` 独立拥有策略演练与临时 SQLite 组装，稳定 `assistant-policy-model` 不再反向依赖 provider。
4. `dsh-profile-installer` 独立拥有通用 DSH 安装器和版本基线；长期 native profile 与待删除 compat overlay 都只依赖它，
   不再互相借用私有实现。
5. compatibility package 内部仍不做精确 import 图，它属于待删除迁移代码；其外部运维入口必须精确登记依赖。

## 后果

新增或修改运维脚本如果跨模块读取，会与普通原生源码一样触发目录变更或职责拆分。跨层是 operations 的明确能力，
不再是未审计的例外；长期功能、产品 profile 和迁移证据也因此可以分别删除或演进。

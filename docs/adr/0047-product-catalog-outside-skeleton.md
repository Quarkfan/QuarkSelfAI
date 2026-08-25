# ADR-0047：产品模块清单不得由骨架 contract 加载或拥有

状态：Accepted（2026-08-25）

## 问题

原 `module-catalog` 同时承担三件事：定义通用 descriptor/validator、从固定路径读取 QuarkSelfAI 清单、拥有包含全部
具体 feature 与 migration 的 JSON 和检查脚本。虽然源码依赖图显示 skeleton 没有 import feature，产品组成事实上
仍被骨架所有，换一套助手组合必须修改所谓稳定骨架。

## 决策

拆成三个责任：

1. skeleton `module-catalog` 只保留纯 descriptor、validator、分析和 provider port；不得 import Node runtime API；
2. feature `assistant-module-catalog` 从配置路径读取并验证当前 QuarkSelfAI 产品清单；
3. feature `architecture-governance` 拥有具体清单资产与仓库检查程序；
4. control console 只依赖 `ModuleCatalogProvider`，由 composition root 注入具体 provider；未装配产品清单时使用明确
   的空 provider，而不是在 surface 内偷偷回读固定文件；
5. migration readiness 可以消费产品 provider，但骨架和普通 feature 不能反向依赖 migration。

## 后果

“骨架如何描述模块”和“这套产品有哪些模块”成为两个可替换层次。未来增加邮件、其他任务系统或新的 harness 时，
只扩充产品清单与功能模块；复用骨架创建另一种助手时，也可以提供独立 catalog，而不复制或修改核心 contract。

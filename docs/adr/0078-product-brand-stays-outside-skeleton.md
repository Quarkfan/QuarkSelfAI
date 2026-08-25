# ADR-0078：产品品牌不进入 skeleton

状态：Accepted（2026-08-25）

## 问题

通用 application host、启动/停止日志和 platform contract 注释仍写死 `QuarkSelfAI`。虽然不形成代码依赖，但会让
骨架默认身份绑定当前产品，未来复用 host 或组合另一套个人助手时必须修改内核。

## 决策

- skeleton 日志只描述通用 assistant host、component 和 DSH kernel；
- platform contract 注释只承诺 assistant-platform extension surface；
- 产品名称、品牌资源和展示文案由 surface/product composition feature 拥有；
- 架构检查把当前产品品牌列入 skeleton 禁止语义。

## 结果

同一骨架可以承载不同产品组合与品牌，不需要 fork 启动器或公共契约。QuarkSelfAI 品牌仍可存在于控制台、部署包、
兼容宿主与产品文档等 feature/migration 所有者中。

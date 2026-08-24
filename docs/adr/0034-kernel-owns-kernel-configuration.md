# ADR-0034：DSH kernel 配置归 kernel supervisor

状态：Accepted（2026-08-24）

## 问题

控制台和执行配置拆出后，`src/bootstrap/config.ts` 只剩 DSH executable、profile、home 与启停模式，但仍以
`AssistantApplicationConfig` 命名并归 application composition。这个宽泛名字会诱导后续功能把 Web、数据库、通道
或迁移 selector 再次塞回“全局应用配置”，重新形成骨架 service locator。

## 决策

1. 配置移动为 `src/runtime/kernel-config.ts`，由 `kernel-supervisor` 模块拥有。
2. 类型和加载器分别改名为 `AssistantKernelConfig`、`loadAssistantKernelConfig`，只暴露 `kernel` 字段。
3. application composition 只消费该窄配置；当前 migration `RuntimeConfig` 在外层组合 kernel、execution、console、
   storage 与 compat selector。
4. 环境变量、默认 profile 规则、DSH executable 查找顺序和运行行为不变。

## 后果

新增 feature 必须拥有自己的配置解析和 schema，不能扩张一个全局 `ApplicationConfig`。删除控制台、compat 或更换存储
时，kernel 配置及 supervisor 不受影响；替换 DSH kernel 时，相关配置也能随同一个模块一起替换。

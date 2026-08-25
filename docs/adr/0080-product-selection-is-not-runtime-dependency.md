# ADR-0080：产品选择不复制成 composition runtime dependency

状态：Accepted（2026-08-25）

## 问题

`product-composition.json` 已选择长期产品模块，`cordis.patch.yml` 也物理挂载所有插件，但
`native-product-composition.runtimeDependsOn` 再次逐项复制了整份模块列表。新增或替换功能必须同步三处，且任何
一处漏改都会造成虚假 readiness 或陈旧依赖。

## 决策

- product manifest 负责产品能力选择；
- Cordis profile 与模块 `mounts` 负责物理插件装配；
- module runtime graph 根据 service/effect capability 解析 provider；
- native product process 的 `runtimeDependsOn` 只保留自身启动必需的 `dsh-runtime`；
- 架构检查拒绝再次把产品清单复制进该字段。

## 结果

产品选择、物理装载和能力解析各有一个真源。新增“肉”不需要把同一模块名再写入原生进程依赖列表，readiness 仍从
manifest roots 与统一运行图得到完整闭包。

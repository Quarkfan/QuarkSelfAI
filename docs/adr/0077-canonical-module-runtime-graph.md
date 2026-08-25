# ADR-0077：module catalog 提供唯一运行依赖图

状态：Accepted（2026-08-25）

## 问题

目录校验、原生 readiness 和浏览器控制台分别从 descriptor 计算 service/effect provider。虽然当前规则一致，但任何
一处新增关系类型或自环例外，都可能让启动门禁与展示结果再次漂移。

## 决策

- module-catalog 骨架提供 `analyzeModuleRuntimeGraph`，统一生成 `runtime`、`mount`、`service`、`effect` 四种边；
- 提供 `moduleRuntimeDependencyClosure` 计算去重的传递运行闭包；
- 环检测、产品 runtime status/readiness 和控制台均消费同一图语义；
- source `dependsOn` 仍独立存在，不混入运行图；
- 控制台 API 返回可序列化图，浏览器不再自行搜索 provider。

## 结果

模块选择、能力解析、启动阻断和人类可见架构图共享同一真源。未来增加新的 provider 或替换实现，只需修改目录与
统一分析器，不需要同步多套隐含规则。

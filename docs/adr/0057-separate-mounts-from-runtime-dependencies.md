# ADR 0057：Profile 挂载与运行依赖分离

## 状态

Accepted

## 问题

`runtimeDependsOn` 曾同时表示 Cordis provider 注入和 profile 预装插件。于是 active 的长期 profile 可以指向多个
inactive 模块，目录无法执行“active consumer 的 provider 必须可用”这一基本约束。

## 决策

1. `runtimeDependsOn` 只表示 live consumer 真正需要的 provider；active 模块的依赖必须 active/static。
2. 新增 `mounts`，只允许 operations composition 使用，表示配置选择关系而不宣称被挂载模块已取得运行所有权。
3. `native-product-profile` 通过 mounts 声明所有 Cordis 插件，当前状态为 shadow；其 live runtime 依赖只有 DSH。
4. compatibility overlay mounts 长期 profile，live runtime 依赖同样只有 DSH。
5. 原生 readiness 从产品能力递归展开 `runtimeDependsOn` 与 `mounts`，因此预装关系在切换门禁中仍必须全部 ready。

## 结果

模块目录可以同时真实表达“代码已经进入 profile”和“provider 已经在生产运行”。维护窗口将长期 profile与各 native
owner 一起改为 active；此前不能用 bundle 已加载冒充接管完成。

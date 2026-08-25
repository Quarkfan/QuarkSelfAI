# ADR 0081：插件激活门禁由模块拥有

状态：accepted

## 背景

长期 product manifest 与 Cordis profile 曾分别维护同一组 `QUARK_NATIVE_*` 开关。两份列表虽然可以在架构检查时
比较，却没有表达每个门禁属于哪个插件；新增、改名或拆分能力时容易出现同步漂移。

## 决策

1. `runtime=inactive` 的可加载插件必须在模块目录声明唯一的 `plugin.activationGate`。
2. gate 必须匹配 `QUARK_NATIVE_[A-Z][A-Z0-9_]*`；active、shadow 和非插件模块不得持有 gate。
3. product manifest v2 不再保存 `requiredEnvironment`，而是从产品所选 inactive 插件派生并排序输出。
4. Cordis profile 必须在对应插件块中精确消费该模块的 gate，不能缺失、替换或同时引用另一个 native gate。
5. 兼容 overlay 仍负责迁移期的无条件禁用，但不成为长期 gate 的所有者。

## 结果

模块目录成为激活权限的唯一真源，产品启动门禁、profile 装载和控制台展示共享同一份派生结果。新增插件仍需显式
声明门禁，因此不会因为遗漏产品级开关列表而静默进入不可启动或不可审计状态。

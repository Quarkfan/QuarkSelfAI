# ADR 0024：插件绑定属于模块契约

状态：accepted

## 背景

一个 QuarkSelfAI 插件要实际进入 DSH，需要同时出现在模块目录、`package.json#exports` 和 Cordis profile。
过去这三处只靠开发者手工保持一致，模块即使标记为 ready，也可能因为漏掉 export 或 profile 条目而无法装载；
反过来，profile 也可能挂载一个没有架构 owner 的本地插件。

## 决策

1. 可加载模块在 `config/module-catalog.json` 中声明 `plugin.profileId` 与 `plugin.packageExport`；没有独立插件
   入口的 contract、policy helper 或 migration 模块不声明该字段。
2. profile id 和 package export 在整个目录中都必须唯一，防止两个模块争用同一个装载身份。
3. `architecture:check` 读取实际 `package.json` 与 `cordis.patch.yml`，验证每个绑定都存在且指向相同包名。
4. profile 中所有 `@quarkfan/quark-self-ai` 插件必须反向映射到一个模块；外部 DSH provider 不由本目录认领。
5. `runtime=inactive` 插件必须在长期 profile 中使用独立 `QUARK_NATIVE_*` 激活门禁；`runtime=active/shadow`
   模块不得使用该门禁。兼容期禁用由独立 profile overlay 精确覆盖所有 inactive plugin，不得混进长期 bundle。

## 结果

插件代码、架构 owner、运行状态、长期激活门禁与兼容 overlay 之间的漂移会在构建时失败。新增能力仍需写物理 export/profile 条目，但模块
目录成为它们的校验真源；未来生成器或对话式插件创建能力可以从同一绑定生成这些文件，而不必改变骨架契约。

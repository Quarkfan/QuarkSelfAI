# ADR 0058：Package export 服从模块源码所有权

## 状态

Accepted

## 问题

插件目录曾只检查 `package.json#exports` 是否包含声明的 key。一个 key 即使误指向其他模块的构建文件，Cordis profile
仍能解析包名，架构检查也会通过。DSH bundle patch 路径同样没有直接门禁。

## 决策

1. 每个 plugin binding 的 export 必须同时声明 `import` 与 `types`。
2. 两个目标必须映射回同一个 TypeScript source，且该 source 出现在绑定模块的 `owns` 中。
3. 稳定 `./platform` export 适用同一反向所有权校验。
4. `package.json#dsh.bundle.patch` 必须精确等于 `./cordis.patch.yml`。

## 结果

插件 key、实际构建入口、类型入口、源码 owner 与 Cordis 挂载形成闭环。快速修改 package manifest 时，不能把一个
模块的公开身份静默接到另一个实现或迁移 profile。

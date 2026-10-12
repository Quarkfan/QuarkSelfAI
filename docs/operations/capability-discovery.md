# 能力目录：按需发现与详情读取（第一批）

状态：离线契约已实现，运行时未挂载。目标是让未来 Skill 和 Capability 数量增长时，新会话先看到少量相关入口，再按需读取详情，而不是加载所有正文。本手册不表示任何候选已经安装、授权或可执行。

## 当前数据和调用

`compileCapabilityDiscoveryIndex` 从 `config/capability-artifact-candidates.json` 和 `config/external-capability-sources.json` 编译只读投影；前者是第一方能力候选，后者是外部候选来源，均为原有机器真源，不另维护手填目录。`discoverCapabilities(index, query, limit)` 返回轻量引用、匹配词和状态；`index.inspect(id)` 才返回所选项的 blockers、版本、来源和详情引用。调用方只把 discover 的少量结果放入模型上下文，需要时再 inspect 所选项。

```ts
const index = compileCapabilityDiscoveryIndex(candidateCatalog, externalSourceCatalog, new Date().toISOString())
const refs = discoverCapabilities(index, 'feishu messaging', 5)
const selected = refs[0] && index.inspect(refs[0].id)
```

查询最长 160 字符、最多 12 个词，结果上限 50；首批仅做精确 token 预筛选，调用方负责语义意图判断。第一方候选总是先于外部候选；无命中返回空结果，不自动调用外部服务。ID 重复、错误 schema、候选提前激活或来源过期均不能被包装成“可运行”。外部过期来源仅可作为 `stale-inactive` 历史参考。所有返回项 `executable=false`，后续安装、授权、运行和外部 effect 仍需各自门禁。

这里的 inspect 读取的是已验证的本地目录详情，不会 fetch 远程 Skill 或 endpoint schema。未来真实 Skill 进入目录时，先登记轻量描述符与来源 revision/digest，再经用户/租户作用域筛选，选中后按需加载本地 Skill 和 references；执行仍走现有 Capability/Approval/Client 边界。不能把 Monid 或其他供应商返回的 hints 当作授权、路由优先级或可执行性声明。

现阶段目录未接入云端、客户端、Agent Studio 或实际 Skill 文件，因此没有完成“海量 Skill 的自动调度”。下一阶段需补真实 Skill 元数据采集、按用户/租户授权过滤、语义候选召回与离线评价，并以三执行器回放验证误触发和负迁移。产品批次和门禁见[实施总计划](../product/feishu-first-workspace-implementation-plan.md)。

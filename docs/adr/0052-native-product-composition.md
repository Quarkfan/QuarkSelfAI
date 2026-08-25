# ADR-0052：兼容宿主退出前必须存在独立原生产品宿主

状态：Accepted（2026-08-25）

## 问题

唯一进程入口 `src/app.ts`、顶层 runtime selector 和 composition 都归 `bridge-compat-host`。原退出计划要求删除这个
模块，却没有长期 native entry；照计划执行会在删除兼容消费者的同时删除应用启动、控制台和父 DSH 监管入口。
此外，action worker 没有进入任何 cutover target，action 可以持久入队但没有原生执行 owner。

## 决策

1. 信号处理、组件失败传播和逆序停止抽成 skeleton `runAssistantApplication`，不认识产品或迁移模式；
2. 新增 feature `native-product-composition`，拥有独立 `src/product/app.ts`、配置、composition、runtime status 与
   readiness provider；它不 import parity、compat 或 legacy state；
3. `config/product-composition.json` 是长期产品能力真源，按 capability 精确列出 native module owner，并声明与 Cordis
   profile 完全一致的 `QUARK_NATIVE_*` 开关及不可缺失配置名；不保存任何密钥值；
4. native entry 只接受 `ASSISTANT_RUNTIME=native` 和 DSH kernel。模块未 active、开关未全部为 true、配置缺失或
   storage provider 未 ready 时，在创建 store 和启动消费者之前失败关闭；
5. 原生 runtime status/readiness 从长期 product manifest、开放 module catalog 和 kernel 状态生成，不读取迁移 parity；
6. `native-product-composition` 与 `agent-bound-action-worker` 一并进入 message/execution cutover target；compat entry
   保持现网 owner，直到获得维护窗口批准并完成单 owner 切换。

## 后果

`retire-compat-host` 现在有明确替代目标，删除迁移宿主不会删除整个应用。未来新增长期能力必须进入产品 manifest、
模块目录和 Cordis profile；三者漂移会被架构检查阻断。当前新增入口只是 ready/inactive 产物，不会因代码合并而
启动第二个飞书消费者或产生外部写入。

# ADR-0041：提交驱动的 durable runtime 共用骨架调度器

状态：Accepted（2026-08-25）

## 问题

durable inbox、workflow 和 action ledger 都需要“提交后立即处理、未来重试按时处理、重启后可以恢复”。分别维护
timer、drain 和 fallback poll 会形成三套细微不同的并发语义；action worker 还保留了每 30 秒空扫描。

Cordis 的注入校验只在插件依赖追踪作用域内有效。原生 timer callback 离开该作用域后再读取注入的 state capability
会失败，因此仅把重复代码抽成工具并不足以形成可靠骨架。原聚合 `quarkState` 已由 ADR 0072 拆分，但构造期捕获
窄端口的要求不变。

## 决策

- 建立 skeleton/kernel 模块 `durable-wake-scheduler`，统一 coalesced immediate wake、最早 exact deadline、最多
  100 次连续 drain、dispose 和 10 分钟 recovery scan；
- event、workflow 和 action runtime 只提供一次执行函数及“是否继续 drain”的判定，不各自拥有调度算法；
- runtime class 显式声明 Cordis inject，并在构造期解析稳定窄端口；timer callback 不再动态读取注入 provider；
- durable state 在无审批 action 首次入账、批准通过和 retry release 成功提交后发布 `quark/action-wake`；等待审批、
  重复幂等 enqueue、拒绝或终态失败不发布可执行提示；
- action worker 启动时主动 drain 一次，覆盖 action 早于插件装载或进程刚恢复的窗口；
- action worker 对未来 retry 使用精确 timer，10 分钟扫描只恢复进程崩溃、漏 hint 和失效 lease；
- hint 投递失败只记录诊断，不反转已经提交的数据库结果。

## 后果

三类 durable runtime 共享一套可测试的并发骨架。正常动作不再承受 30 秒扫描延迟，也不会在空闲时持续查询；数据库
仍是唯一真源，所以提示可以重复或丢失，恢复扫描仍能最终重新发现工作。新增 durable consumer 应复用该调度器，
除非通过新 ADR 证明其调度语义确实不同。

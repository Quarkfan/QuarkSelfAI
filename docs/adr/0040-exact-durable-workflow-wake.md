# ADR-0040：workflow transition 提交后按精确时间唤醒

状态：Accepted（2026-08-25）

## 问题

durable workflow 解决了跨重启状态所有权，但 runtime 每 30 秒扫描一次数据库。即时 effect 因而平白增加延迟；若
单纯把扫描改为 10 分钟，本人私聊、批准卡片和任务投影也会变慢。

## 决策

- durable state 在 create/advance 成功后计算 instance `wakeAt` 与新 effects `availableAt` 的最早值，发布
  `quark/workflow-wake`；幂等未插入、revision 未推进时不发布；
- effect 非终态释放时按新的 `availableAt` 再次调度；
- runtime 对已到期/无时间的 hint 合并即时 drain，对未来 hint 只保留最早精确 timer；超出平台 timer 上限时分段；
- definition 或 effect handler 注册时即时扫描一次，覆盖状态早于插件装载的窗口；
- 10 分钟扫描只恢复进程重启、漏 hint 或丢失内存 timer，不承担正常处理延迟；
- hint listener 失败不能反转已经提交的数据库 transition。

## 后果

即时 effect 在同一守护进程内直接继续，未来 timer 按业务时间触发，空闲时不再每 30 秒查询。数据库仍是唯一真源：
进程在 commit 与 hint 之间崩溃时，恢复扫描最多延迟 10 分钟但不会丢工作。

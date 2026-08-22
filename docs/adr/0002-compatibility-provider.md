# ADR 0002：以叶子兼容 Provider 承接现网能力

## 状态

Accepted for migration preparation；尚未批准生产切换。

## 决策

现有 `codex-lark-bridge` 的成熟实现以 `packages/bridge-compat` 形式原样纳入仓库，并由
`CompatRuntime` 作为 DSH/Cordis 外侧的临时叶子 Provider 管理。兼容包不是新内核，不得反向控制
DSH 生命周期、领域模型或新存储。新能力继续落在 channel、domain、policy、executor 和 projection
边界内，逐项替换兼容包能力。

兼容运行模式默认关闭。启动它必须同时满足：

1. `ASSISTANT_RUNTIME=compat`；
2. 指定可读的 `COMPAT_CONFIG_PATH`；
3. 常东旭明确批准切换后才设置 `TAKEOVER_CONFIRMED=true`；
4. 正式操作前 `npm run takeover:preflight` 返回 `ready=true`；
5. 旧消费者已优雅退出，保证不存在两套消息或卡片消费者。

## 不变量

- 旧仓库、旧配置、旧状态和 LaunchAgent 在准备阶段只读；
- 状态迁移只能复制、校验 fingerprint 和回放，不原地改写；
- 未经批准不停止旧服务、不改变状态写入点、不启用新消费者；
- 子进程只用 `SIGTERM` 优雅停止，超时进入 degraded，不使用 `SIGKILL`；
- 兼容包功能状态只能在实现、契约测试、回放和运行手册证据齐全后标记 complete。

## 退出条件

当每项兼容能力都有 DSH-native 插件替代、历史回放一致、生产观察窗口完成并具备一键回滚时，
删除兼容 Provider。删除本身另行审批，不与功能迁移混在一个发布中。

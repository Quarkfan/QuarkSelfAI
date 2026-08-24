# ADR 0021：Codex 会话生命周期只接受 app-server 权威活动状态

状态：accepted

## 背景

QuarkSelfAI 自动创建的调研会话需要在完成后归档，并在归档满七天后删除。Codex 的 SQLite `threads`
表能证明会话存在、归档状态和归档时间，却没有“当前是否仍在执行”的权威字段。仅通过进程列表、更新时间、
锁文件或 SQLite 推断空闲，可能在会话仍运行时归档或删除。

桌面应用的私有 IPC socket 不是公开契约。直接读取或模拟该协议会让个人助手依赖不可验证的内部实现，也可能
干扰桌面应用。

## 决策

1. 活动状态通过 Codex 公共 app-server JSON-RPC 协议读取：连接已配置的 app-server control socket，初始化后调用
   `thread/read`，且不加载 turns。
2. `active` 映射为运行中，`idle` 映射为空闲；`notLoaded`、`systemError`、超时、进程退出和协议异常都映射为
   `unknown`。
3. 只有明确的 `idle` 能通过归档或删除前的活动门禁。SQLite 继续负责写前/写后的存在性、归档状态和保留期核验。
4. profile 必须同时具备显式 native 开关和 `CODEX_APP_SERVER_SOCKET` 才装载 adapter；compat 模式始终禁用。
5. 不连接桌面应用私有 IPC，不把“未加载”解释成“空闲”，也不自动启动第二个 app-server 与桌面端争用状态库。

## 结果

adapter 已具备可替换的异步活动探针和公共协议实现，但在真实共享 app-server socket 完成只读回放前仍标为
`partial/inactive`。后续可以由桌面宿主或独立、受监督的 Codex app-server 提供 socket，不需要改变 workflow 或
会话生命周期领域契约。运行所有权切换属于维护窗口动作，不能随代码部署自动发生。

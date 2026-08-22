# 接管准备证据（2026-08-22）

## 当前结论

QuarkSelfAI 已具备本地优先运行、DSH 装配、兼容能力承载、持久化和守护部署基线，但尚不满足生产接管
门禁。旧 `codex-lark-bridge` 必须继续保持唯一现网消费者；本轮没有停止、重启或修改其 LaunchAgent，
也没有执行飞书或滴答外部写入。

## 已验证

- `npm run check`：主包 56 项（沙箱内 54 通过、回环 E2E 2 跳过），兼容包 99 项全部通过；Web 控制台
  和守护重启两个回环 E2E 已在允许监听的本地环境分别通过。
- `npm run compat:dsh`：DSH `0.1.1-rc.2`、commit `b150a55` 与 baseline 一致，构建产物为 named
  namespace plugin；隔离 `feishu-assistant` profile 的配置包含 Lark、BlackLake、Claude/Codex 读写隔离
  Provider 和 executor router，并已完成真实 profile 启动、SIGTERM 清洁退出烟测。
- `npm run compat:live-bridge`：现网 bridge 的 27 个业务/协议文件在兼容 Provider 中均存在，没有 live-only
  文件；6 个差异文件已逐一限定为 Quark 控制面/自然语言策略的加法改动，另有 1 个 additive control-plane
  client。live/compat 内容哈希分别为 `b9f33c0c3e4f912c0c9d2b345043d133e5af957c8124698bbb05baddf02e91b7`
  和 `34060e95ce2c2fc93a1550995b4d5efd5c01f3340183f0395e4f6f9ab36d9cda`；后续任一侧漂移都会 fail-closed。
- Claude Code `2.1.177` 已登录；损坏的 Codex CLI 已在线重装为 `0.149.0` 并确认登录。实际模型读取本地文件
  会把内容发送到模型服务，必须使用明确获准的脱敏样本，不能把普通仓库文件当烟测材料。
- 两个真实模型通道已用固定合成文本握手：Claude 返回 `QUARK_CLAUDE_OK`；Codex `gpt-5.6-sol/medium`
  最终返回 `QUARK_CODEX_OK`。Codex 期间发生 WebSocket 重连、HTTPS fallback 和超时告警，故结论是“可用但
  当前退化”，不是健康。Claude 当前 `claude auth status` 显示 first-party OAuth，尚无证据证明已走低价
  第三方模型；系统现已支持从运行环境显式注入 Anthropic key/token 且配置 dump 不暴露值，但不能在未提供
  第三方通道配置时宣称成本路由目标已达成。
- 本地默认：SQLite、`127.0.0.1` 控制台、local execution；工作区 policy 拒绝目录穿越和符号链接逃逸，
  compatibility provider 启动前验证 `workspaceRoot`。Claude/Codex 只读任务使用非写入 Provider，只有持久
  owner approval 存在时才路由到写入 Provider。
- DSH profile 已实际创建 SQLite action ledger。读任务在 lease 到期后可由新 worker 恢复，旧 worker 提交
  被拒绝；写任务在精确 approval 持久化前不可 claim；两次基础设施失败可退避后由同一 action 恢复完成。
- 旧状态只读审计：`handoffSafe=true`，controller queue=0，pending focus messages=0，无重复 owner/focus/card
  ID，无无效 operational timestamp。
- 可恢复工作：3 个待确认调研；它们属于迁移项，不是清空要求。
- 一条业务 dueDate 格式告警会原样保留，在 DSH-native 导入时规范化，不阻塞 checkpoint。
- 最新只读审计基于旧状态 SHA-256 `3409ff988aa1d0aae80304cde4cba250188f8e5f12a634b38abb5c5544ace3bb`，
  修改时间 `2026-08-22T11:51:27.972Z`；queue 和 pending focus 均为 0，handoff 仍安全。
- 无写影子窗口正在运行（`2026-08-20T11:52:20.935Z` 至 `2026-08-27T11:52:20.935Z`）：当前 41 个
  决策、23 个 matter、14 个滴答快照、2 个反馈、23 次任务创建或更新；机器审计已核对事项引用、任务
  准入、创建/更新 ID、行动责任、下一步、通知层级映射、任务快照和反馈结构，均有效且无重复 messageId。
  修正原先把 `aligned` 也计为差异的问题后，真实差异为 6 条，全部属于现有即时通知可合并为当日汇总的
  `could_batch`，未发现 `possible_miss`；审计不输出业务正文。窗口未结束，不能提前视为通过。
- control-only 守护进程已在同一 SQLite 文件上完成启动、健康读取、SIGTERM、再次启动、健康读取、再次
  SIGTERM 的真实进程级演练；两个代际都只看到同一条种子事件，没有丢失或重复。
- 正式本地 DSH profile 已由 `npm run setup:dsh` 在项目 `var/dsh` 初始化并核验固定版本/commit。新守护进程
  在 `control-only` 下实际拉起受监管 DSH 内核，`/api/health` 返回 kernel=`ready`，验证后以 SIGINT 优雅
  停止；现网旧 LaunchAgent 全程保持 running。`ASSISTANT_KERNEL=off` 仅保留给测试/诊断。
- 发布版 DSH 已在隔离目录用 pnpm 11.7.0 安装：固定 `@deepseek-ai/dsh@0.1.1-rc.2` 的 `dsh --version`
  通过。服务器 runtime lock 同时固定 Claude Code/Codex Provider 和所有平台可选载荷 integrity。新的容器
  entrypoint 已在隔离 DSH_HOME 完成首次 profile 初始化、Quark Bundle link、DSH kernel ready、HTTP 200
  health 和 SIGINT 清洁停止；`action_execution` 表实际存在。`npm run compat:server` 对 lock、Dockerfile、
  executable entrypoint 和禁止 kernel-off 做机器校验。
- 已从上述状态生成 rehearsal `f23ade87aaa4dab10ab3`。生成配置显式绑定该只读快照目录与四个 CLI 的
  绝对路径；preflight 证明 stateReadable/handoffSafe/didaCredentialReady/全部 executables 均为 true。
  该 rehearsal 不是最终冻结状态，不能直接用于正式切换。
- `npm run compat:lark` 已验证 lark-cli `1.0.88`、25 个可用 EventKey、消息与卡片两个必需 EventKey，
  schema fingerprint 为 `b0b84ff4a756e8253aefc8c6c08d5193eed1bacddd77a391960113d4cf00bbbf`。

## 未通过的硬门禁

当前滴答 schema 生效时间窗（自 `2026-08-22T08:25:00Z`）只发现 5 个 monitor 结果，没有 task
projection。`--min-task-projections 20 --strict` 因 `0/20` 样本不足退出 1；失败不是 schema violation，
也没有重复 task fingerprint 或外部写入。不得用人工制造测试待办补足数量。

仍需完成：

1. 收集至少 20 个真实、脱敏且无外部写的当前 schema 决策样本，全部通过任务准入、合并、NOTE 防护、
   批准识别、BlackLake skill 路由及通知去重校验。
2. 使用明确批准的脱敏文件样本演练真实 Claude-primary/Codex-fallback、本地文件读取、持久重试、重启恢复、
   action ledger 单执行者和卡片长等待恢复。
3. 在明确批准的维护窗口执行单消费者切换；切换前冻结 checkpoint，失败时停止新消费者后恢复旧服务。
4. Dockerfile 已锁入自包含 DSH CLI 与两个 executor Provider，并通过发布包/entrypoint 的进程级隔离演练；
   但 Docker 实镜像构建仍受本机 Docker daemon HTTP 500 阻塞。该项不影响本地 LaunchAgent 主路径，服务器
   正式发布前仍必须在可用 Docker daemon 上补做 Linux 目标平台镜像构建和 healthcheck。

机器可读状态仍以 `config/feature-parity.json` 为准；本文件不能替代 `TAKEOVER_CONFIRMED=true` 的人工门禁。

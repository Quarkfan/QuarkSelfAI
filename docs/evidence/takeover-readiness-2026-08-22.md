# 接管准备证据（2026-08-22）

## 当前结论

QuarkSelfAI 已具备本地优先运行、DSH 装配、兼容能力承载、持久化和守护部署基线，但尚不满足生产接管
门禁。旧 `codex-lark-bridge` 必须继续保持唯一现网消费者；本轮没有停止、重启或修改其 LaunchAgent，
也没有执行飞书或滴答外部写入。

## 已验证

- `npm run check`：主包 63 项（沙箱内 61 通过、回环 E2E 2 跳过），兼容包 100 项全部通过；Web 控制台
  和守护重启两个回环 E2E 已在允许监听的本地环境分别通过。
- `npm run compat:dsh`：DSH `0.1.1-rc.2`、commit `b150a55` 与 baseline 一致，构建产物为 named
  namespace plugin；隔离 `feishu-assistant` profile 的配置包含 Lark、BlackLake、Claude/Codex 读写隔离
  Provider 和 executor router，并已完成真实 profile 启动、SIGTERM 清洁退出烟测。
- `npm run compat:live-bridge`：现网 bridge 的 27 个业务/协议文件在兼容 Provider 中均存在，没有 live-only
  文件；7 个差异文件已逐一限定为 Quark 控制面/自然语言策略/恢复通知的加法改动，另有 1 个 additive control-plane
  client。live/compat 内容哈希分别为 `b9f33c0c3e4f912c0c9d2b345043d133e5af957c8124698bbb05baddf02e91b7`
  和 `0e9f54e2f2465e08dd308c8219f069a7bfbcc430bc5a27635b8d9ed5bce48b70`；后续任一侧漂移都会 fail-closed。
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
- 最新只读审计基于旧状态 SHA-256 `f52a5f8e753b6f3eb14b33ed8f5bcbb58d71e3cfe0757c28c011cd506e3a1d74`，
  修改时间 `2026-08-22T14:44:28.780Z`；queue 和 pending focus 均为 0，handoff 仍安全；现网卡片回调为
  11 个且无重复，本次受控演练批准已被持久化处理。
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
- 影子来源聚合覆盖 `@常东旭` 8 条、他人私聊 31 条、特别关注任永强 3 条、飞书标记会话 1 条；41/41
  来源都带已读取的上下文，覆盖 18 个会话和 16 个发送人。`focus-intake` 因而已有实现、契约测试和现网
  无写回放三层证据。
- 2026-08-22 使用 `lark-cli im +chat-search --as user` 对典型外部群“油脂客户沟通群”执行实时只读查询，
  标准群属性明确返回 `external=true`；没有读取群消息或执行写入。结合 external/unknown 群全交互阻断测试
  和 41 条上下文样本，`context-and-external-guard` 已满足能力验证要求。
- 最新严格旧状态审计显示：8 条本人消息已由持久 controller/current session 处理且队列为 0；10 个卡片
  回调无重复，3 个待确认研究动作可恢复；超期、完成清理和工作日跟进三类 monitor 都有真实运行记录且
  当前健康故障为空；2/2 自动研究会话均已归档并删除，归档/删除失败累计为 0；3/3 智造湖小维请求已
  完成且关联回复消息。对应总控、卡片、monitor、会话清理和小维通道不再只依赖单元测试。
- 根据 ADR 0003，本地 macOS 守护是接管硬门禁，Linux/容器是可选服务器形态。`daemon-deployment` 已按
  本地真实进程和 LaunchAgent 证据标记完成；Docker 实镜像构建独立为非接管必需的 `server-deployment`，
  仍保持 partial，不能用于宣称服务器发布就绪。
- BlackLake DSH-native planning 已接入 action ledger：三源新鲜度与 skill/operation-chain 通过后，`skip`
  不入账，`confirm` 生成带精确批准的只读 action，`start` 仅接受生产/安全/客户阻塞且目标、证据缺口和
  直接收益同时明确的情况。SQLite/PostgreSQL claim 逻辑已修正为“只要 action 显式带 approval 就必须先
  approved”，不再让 read-only 绕过确认。固定合成用例已证明批准前不可 claim、批准后由 Claude-primary
  action 可 claim，且没有启动真实调研或访问业务文件。
- 常东旭已通过现网 Card 2.0 输入框和按钮批准四项固定合成受控演练。自然语言策略在隔离 SQLite 用 20 条
  样本完成幂等 revision、激活和回滚；桌面端以 `gpt-5.6-sol/medium` 完成唯一标题 task 的左侧可见和续接；
  Claude `start/ENOENT` 完全释放后，独立真实 Codex fallback task 返回 `QUARK_EXECUTOR_FALLBACK_OK`；
  隔离飞书 connector 完成故障跨重启持久化、恢复合并补发、北京时间和去重验证。四项均无业务外部写入。
- 演练同时识别并保留两项真实限制：桌面任务中嵌套 `codex exec` 会超时或被 SIGTERM，不能作为桌面端
  fallback；已归档 task 恢复后可能生成空 turn，因此失败续接不能误报成功，真实 fallback 应创建唯一标题
  task 并受 action 幂等与生命周期约束。

## 未通过的硬门禁

当前滴答 schema 生效时间窗（自 `2026-08-22T08:25:00Z`）发现 13 个 monitor 结果，没有 task
projection。`--min-task-projections 20 --strict` 因 `0/20` 样本不足退出 1；失败不是 schema violation，
也没有重复 task fingerprint 或外部写入。不得用人工制造测试待办补足数量。

补充的严格血缘审计不再只依赖时间戳：它把 `result.json` 与已处理 message ID、影子 decision 的 taskAction/
taskId 关联，再要求完全匹配当前 JSON Schema 和语义校验。41 条影子 decision 均能找到旧结果，但全部缺少
当前 schema 的完整字段，因此 `exactSchemaAccepted=0`、`legacySchemaSkipped=41`。这排除了统计口径误判，
也证明不能把旧样本冒充当前证据。审计只输出聚合数字和哈希，不输出业务正文。

Codex 桌面已建立线程心跳 `quarkselfai`（“QuarkSelfAI 接管门禁检查”），每天 10:15 在本机只读重跑
current-schema 投影与影子审计。未满足时保持门禁且不重复通知；两项都通过后只会回到本任务运行完整预检
并请求维护窗口批准，不会创建测试任务、修改旧 bridge、启动新消费者或自动切换。

仍需完成：

1. 收集至少 20 个真实、脱敏且无外部写的当前 schema 决策样本，全部通过任务准入、合并、NOTE 防护、
   批准识别、BlackLake skill 路由及通知去重校验。
2. 等待无写影子窗口于 `2026-08-27T11:52:20.935Z` 完成，再运行严格审计并评估当前 6 条 `could_batch`
   差异；窗口未完成前不得提前判定协作质量通过。
3. 在明确批准的维护窗口执行单消费者切换；切换前冻结 checkpoint，失败时停止新消费者后恢复旧服务。
4. Dockerfile 已锁入自包含 DSH CLI 与两个 executor Provider，并通过发布包/entrypoint 的进程级隔离演练；
   但 Docker 实镜像构建仍受本机 Docker daemon HTTP 500 阻塞。该项不影响本地 LaunchAgent 主路径，服务器
   正式发布前仍必须在可用 Docker daemon 上补做 Linux 目标平台镜像构建和 healthcheck。

机器可读状态仍以 `config/feature-parity.json` 为准；本文件不能替代 `TAKEOVER_CONFIRMED=true` 的人工门禁。

# 接管准备证据（2026-08-22）

## 当前结论

QuarkSelfAI 已具备本地优先运行、DSH 装配、兼容能力承载、持久化和守护部署基线，但尚不满足生产接管
门禁。旧 `codex-lark-bridge` 必须继续保持唯一现网消费者；本轮没有停止、重启或修改其 LaunchAgent，
也没有执行飞书或滴答外部写入。

## 已验证

- `npm run check`：主包 46 项（沙箱内 45 通过、回环 E2E 1 跳过），兼容包 99 项全部通过；回环 E2E
  已在允许监听的本地环境单独通过。
- `npm run compat:dsh`：DSH `0.1.1-rc.2`、commit `b150a55` 与 baseline 一致，构建产物为 named
  namespace plugin；隔离 `feishu-assistant` profile 的配置包含 Lark、BlackLake、Claude/Codex 读写隔离
  Provider 和 executor router，并已完成真实 profile 启动、SIGTERM 清洁退出烟测。
- Claude Code `2.1.177` 已登录；损坏的 Codex CLI 已在线重装为 `0.149.0` 并确认登录。实际模型读取本地文件
  会把内容发送到模型服务，必须使用明确获准的脱敏样本，不能把普通仓库文件当烟测材料。
- 本地默认：SQLite、`127.0.0.1` 控制台、local execution；工作区 policy 拒绝目录穿越和符号链接逃逸，
  compatibility provider 启动前验证 `workspaceRoot`。Claude/Codex 只读任务使用非写入 Provider，只有持久
  owner approval 存在时才路由到写入 Provider。
- DSH profile 已实际创建 SQLite action ledger。读任务在 lease 到期后可由新 worker 恢复，旧 worker 提交
  被拒绝；写任务在精确 approval 持久化前不可 claim；两次基础设施失败可退避后由同一 action 恢复完成。
- 旧状态只读审计：`handoffSafe=true`，controller queue=0，pending focus messages=0，无重复 owner/focus/card
  ID，无无效 operational timestamp。
- 可恢复工作：3 个待确认调研；它们属于迁移项，不是清空要求。
- 一条业务 dueDate 格式告警会原样保留，在 DSH-native 导入时规范化，不阻塞 checkpoint。
- 最新只读审计基于旧状态 SHA-256 `9f83e7cb4116496d8233134792941c91a19f8a2769af6a27044dc05cce1944ad`，
  修改时间 `2026-08-22T11:36:27.943Z`；queue 和 pending focus 均为 0，handoff 仍安全。
- 无写影子窗口正在运行（`2026-08-20T11:52:20.935Z` 至 `2026-08-27T11:52:20.935Z`）：当前 41 个
  决策、23 个 matter、14 个滴答快照、2 个反馈；窗口未结束，不能提前视为通过。

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
4. Docker 实镜像构建仍受本机 Docker daemon HTTP 500 阻塞；本地 LaunchAgent 主路径不依赖该项，
   服务器发布前必须补验。

机器可读状态仍以 `config/feature-parity.json` 为准；本文件不能替代 `TAKEOVER_CONFIRMED=true` 的人工门禁。

# 接管准备证据（2026-08-22）

## 当前结论

QuarkSelfAI 已具备本地优先运行、DSH 装配、兼容能力承载、持久化和守护部署基线，但尚不满足生产接管
门禁。旧 `codex-lark-bridge` 必须继续保持唯一现网消费者；本轮没有停止、重启或修改其 LaunchAgent，
也没有执行飞书或滴答外部写入。

## 已验证

- `npm run check`：主包 34 项（沙箱内 33 通过、回环 E2E 1 跳过），兼容包 99 项全部通过；回环 E2E
  已在允许监听的本地环境单独通过。
- `npm run compat:dsh`：DSH `0.1.1-rc.2`、commit `b150a55` 与 baseline 一致，构建产物为 named
  namespace plugin，隔离 `feishu-assistant` profile 的 `--dump-config` 包含 `feishu-lark-cli`。
- 本地默认：SQLite、`127.0.0.1` 控制台、local execution；工作区 policy 拒绝目录穿越和符号链接逃逸，
  compatibility provider 启动前验证 `workspaceRoot`。
- 旧状态只读审计：`handoffSafe=true`，controller queue=0，pending focus messages=0，无重复 owner/focus/card
  ID，无无效 operational timestamp。
- 可恢复工作：3 个待确认调研；它们属于迁移项，不是清空要求。
- 一条业务 dueDate 格式告警会原样保留，在 DSH-native 导入时规范化，不阻塞 checkpoint。

## 未通过的硬门禁

当前滴答 schema 生效时间窗（自 `2026-08-22T08:25:00Z`）只发现 5 个 monitor 结果，没有 task
projection。`--min-task-projections 20 --strict` 因 `0/20` 样本不足退出 1；失败不是 schema violation，
也没有重复 task fingerprint 或外部写入。不得用人工制造测试待办补足数量。

仍需完成：

1. 收集至少 20 个真实、脱敏且无外部写的当前 schema 决策样本，全部通过任务准入、合并、NOTE 防护、
   批准识别、BlackLake skill 路由及通知去重校验。
2. 演练持久重试、重启恢复、Claude-primary/Codex-fallback 单执行者和卡片长等待恢复。
3. 在明确批准的维护窗口执行单消费者切换；切换前冻结 checkpoint，失败时停止新消费者后恢复旧服务。
4. Docker 实镜像构建仍受本机 Docker daemon HTTP 500 阻塞；本地 LaunchAgent 主路径不依赖该项，
   服务器发布前必须补验。

机器可读状态仍以 `config/feature-parity.json` 为准；本文件不能替代 `TAKEOVER_CONFIRMED=true` 的人工门禁。

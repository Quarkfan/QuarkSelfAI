# lark-cli 升级手册

## 原则

业务插件只依赖稳定领域事件；版本、命令、EventKey、schema 和身份差异全部由 adapter 吸收。

## 升级流程

1. 查看新版本与发布说明，但不要直接替换现网 CLI。
2. 在隔离环境安装候选版本。
3. 运行 `npm run compat:lark`，保存版本、能力计数和 fingerprint。
4. 比较必需事件 schema；新增可选字段通常无需修改业务层，删除/改名/身份变化必须 fail-closed。
5. 运行 `npm run check` 和脱敏历史事件回放。
6. 影子运行只读消费者；验证断线、ready、SIGTERM 和 checkpoint 恢复。
7. 一次只升级一个实例，保留旧 CLI 和回滚命令。
8. 观察期通过后再更新 `config/lark-cli-contract.json` 的最低版本和长期适配器契约。

## 新功能接入

新 EventKey 先由 `event list --json` 被发现，再读取 `event schema <key> --json`。若业务需要：

1. 加入 capability manifest；
2. 添加 normalizer，但始终保留完整 `raw`；
3. 编写 schema/身份/幂等键契约测试；
4. 最后才启用对应 policy/plugin。

禁止把新 CLI 参数散落到路由、任务或审批模块。

## 成员加入事件

任永强邀请本人入群的实时识别使用 `im.chat.member.user.added_v1`，筛选字段固定为
`event.operator_id.open_id` 与 `event.users[].user_id.open_id`。启用 `membershipRealtimeEnabled` 前必须先在
飞书应用后台订阅该事件，并用 `lark-cli event schema im.chat.member.user.added_v1 --json` 复核字段与 bot
身份；否则保持关闭，依靠 30 分钟群列表差分和系统消息核验兜底，避免未订阅事件导致守护进程重启循环。

## 表情回复事件

本人主动参与链路要求 `im.message.reaction.created_v1` 与 `im.message.reaction.deleted_v1` 同时存在，并分别启动
独立消费者。两者都使用 bot 身份，读取 `.event.message_id`、`.event.user_id.open_id`、
`.event.reaction_type.emoji_type` 和 `.event.action_time`；目标消息由 `im message mget` 回读上下文。只有在两个
消费者都通过 schema/ready 校验后才能打开 `reactionRealtimeEnabled`。低频扫描只补偿新增表情，不根据列表
缺失推断撤回，以免分页或权限变化制造错误的删除事件。

当前最低兼容版本为 `1.0.89`。升级时需要同时检查守护进程配置所引用的绝对 CLI 路径，不能只验证当前 shell
PATH 下的另一个全局安装。

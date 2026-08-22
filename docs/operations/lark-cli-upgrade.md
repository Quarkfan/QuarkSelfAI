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
8. 观察期通过后再更新 `compat/lark-cli.json` 的最低版本和契约快照。

## 新功能接入

新 EventKey 先由 `event list --json` 被发现，再读取 `event schema <key> --json`。若业务需要：

1. 加入 capability manifest；
2. 添加 normalizer，但始终保留完整 `raw`；
3. 编写 schema/身份/幂等键契约测试；
4. 最后才启用对应 policy/plugin。

禁止把新 CLI 参数散落到路由、任务或审批模块。

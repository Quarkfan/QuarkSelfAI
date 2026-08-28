import test from "node:test";
import assert from "node:assert/strict";
import { conversationPendingBatch, deriveConversationAttention, MentionMonitor, isDelegationJoinSystemMessage, isLarkRateLimitError, isLowSignalAcknowledgement, isSyntheticTestMessage, userFacingError } from "../src/mention-monitor.js";

function stateHarness() {
  return {
    state: { mentionLastPollAt: null, mentionPending: [], mentionProcessedMessageIds: [] },
    async save() {},
  };
}

test("finds mentions, reads context, creates one task and deduplicates", async () => {
  const message = {
    message_id: "om_1", chat_id: "oc_1", chat_name: "项目群", chat_type: "group",
    create_time: "2026-08-14 10:00", content: "@常东旭 请跟进", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let creates = 0;
  const lark = {
    async searchMentions() { return [message, message]; },
    async getMentionContext() { return [message]; },
    async send() {},
  };
  const taskCreator = { async createFromMention() { creates += 1; return { taskId: "task_1", title: "跟进事项", url: null }; } };
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state, lark, taskCreator,
  });
  await monitor.poll();
  await monitor.poll();
  assert.equal(creates, 1);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_1"]);
  assert.equal(state.state.mentionPending.length, 0);
});

test("ingests an explicit group mention from the realtime event without a remote search", async () => {
  const state = stateHarness();
  let creates = 0;
  const monitor = new MentionMonitor({
    config: { allowedOpenId: "ou_me", mentionRealtimeSettleDelayMs: 0, mentionContextMinutes: 30 },
    state,
    lark: {
      async getMentionContext(message) { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention(message) {
      creates += 1;
      assert.deepEqual(message.intakeReasons, ["@常东旭"]);
      return { taskId: "task_realtime", taskAction: "ignored" };
    } },
  });
  const realtime = {
    message_id: "om_realtime", chat_id: "oc_group", chat_type: "group", message_type: "text",
    content: "@常东旭 请处理", sender_id: "ou_other", sender_type: "user",
    mentions: [{ id: "ou_me", name: "常东旭", key: "@_user_1" }],
  };

  assert.equal(await monitor.ingestRealtime(realtime), true);
  assert.equal(await monitor.ingestRealtime(realtime), false);
  assert.equal(creates, 1);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_realtime"]);
});

test("ignores a realtime group event that does not explicitly mention the owner", async () => {
  const state = stateHarness();
  const monitor = new MentionMonitor({ config: { allowedOpenId: "ou_me" }, state, lark: {}, taskCreator: {} });
  const accepted = await monitor.ingestRealtime({
    message_id: "om_background", chat_id: "oc_group", chat_type: "group",
    content: "普通群消息", sender_id: "ou_other", sender_type: "user", mentions: [],
  });
  assert.equal(accepted, false);
  assert.equal(state.state.mentionPending.length, 0);
});

test("sends a short acknowledgement to contextual reasoning instead of keyword-dropping it", async () => {
  const state = stateHarness();
  let received = null;
  const monitor = new MentionMonitor({
    config: { allowedOpenId: "ou_me", mentionRealtimeSettleDelayMs: 0, mentionContextMinutes: 30 },
    state,
    lark: {
      async getMentionContext(message) {
        return [
          { message_id: "om_request", content: "今天可以完成客户发布吗？", sender: { id: "ou_me" } },
          message,
        ];
      },
      async send() {},
    },
    taskCreator: { async createFromMention(message, context) {
      received = { message, context };
      return { taskAction: "ignored", notificationDecision: "silent", researchDecision: "skip" };
    } },
  });
  const accepted = await monitor.ingestRealtime({
    message_id: "om_ok", chat_id: "oc_group", chat_type: "group", content: "@常东旭 ok",
    sender_id: "ou_other", sender_type: "user", mentions: [{ id: "ou_me", name: "常东旭" }],
  });
  assert.equal(accepted, true);
  assert.equal(received.message.message_id, "om_ok");
  assert.match(received.context[0].content, /客户发布/);
});

test("merges mentions, watched group messages, and incoming direct messages by message id", async () => {
  const watchedGroupMessage = {
    message_id: "om_watch", chat_id: "oc_group", chat_name: "共同群", chat_type: "group",
    create_time: "2026-08-14 10:00", content: "项目进度有变化", sender: { id: "ou_watch", name: "任永强" },
  };
  const directMessage = {
    message_id: "om_dm", chat_id: "oc_dm", chat_name: "同事", chat_type: "p2p",
    create_time: "2026-08-14 10:01", content: "麻烦看一下", sender: { id: "ou_other", name: "同事" },
  };
  const ownMessage = {
    message_id: "om_own", chat_id: "oc_dm", chat_type: "p2p", content: "好的", sender: { id: "ou_me", name: "常东旭" },
  };
  const state = stateHarness();
  const created = [];
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30,
      allowedOpenId: "ou_me", monitorDirectMessages: true,
      specialAttentionUsers: [{ name: "任永强", openId: "ou_watch" }],
    },
    state,
    lark: {
      async searchMentions() { return [watchedGroupMessage]; },
      async searchSpecialAttentionMessages() { return [watchedGroupMessage]; },
      async searchDirectMessages() { return [directMessage, ownMessage]; },
      async getMentionContext(message) { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention(message) {
      created.push(message);
      return { taskId: `task_${message.message_id}`, title: "【关注】重点消息", urgencyLabel: "关注", priority: 0, tags: ["飞书", "关注"], relationshipSummary: "待关注" };
    } },
  });

  await monitor.poll();

  assert.equal(created.length, 2);
  assert.deepEqual(created.find((message) => message.message_id === "om_watch").intakeReasons, ["@常东旭", "特别关注：任永强"]);
  assert.deepEqual(created.find((message) => message.message_id === "om_dm").intakeReasons, ["他人私聊"]);
  assert.equal(created.some((message) => message.message_id === "om_own"), false);
});

test("coalesces due non-mention messages from one conversation into one task decision", async () => {
  const state = stateHarness();
  state.state.mentionPending = [
    {
      discoveredAt: "2026-08-26T03:30:00Z", readyAt: "2026-08-26T03:40:00Z", attempts: 0,
      message: { message_id: "om_batch_1", chat_id: "oc_batch", chat_type: "p2p", create_time: "2026-08-26 11:30", content: "先确认灾备方式", sender: { name: "同事" }, intakeReasons: ["他人私聊"] },
    },
    {
      discoveredAt: "2026-08-26T03:31:00Z", readyAt: "2026-08-26T04:00:00Z", attempts: 0,
      message: { message_id: "om_batch_2", chat_id: "oc_batch", chat_type: "p2p", create_time: "2026-08-26 11:31", content: "再确认监控归属", sender: { name: "常东旭" }, intakeReasons: ["本人主动参与"] },
    },
  ];
  assert.equal(conversationPendingBatch(state.state.mentionPending, 0, new Date("2026-08-26T03:41:00Z")).length, 2);
  const decisions = [];
  const monitor = new MentionMonitor({
    config: { mentionContextMinutes: 30, mentionConversationBatchWindowMs: 15 * 60_000 },
    state,
    lark: { async getMentionContext() { return []; }, async send() {} },
    taskCreator: { async createFromMention(message) {
      decisions.push(message);
      return { taskId: "task_batch", taskAction: "ignored" };
    } },
  });

  await monitor.processPending();

  assert.equal(decisions.length, 1);
  assert.match(decisions[0].content, /先确认灾备方式/);
  assert.match(decisions[0].content, /再确认监控归属/);
  assert.deepEqual(decisions[0].batchedMessageIds, ["om_batch_1", "om_batch_2"]);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_batch_1", "om_batch_2"]);
  assert.equal(state.state.mentionPending.length, 0);
});

test("syncs active flag chats and monitors their new messages", async () => {
  const flaggedMessage = {
    message_id: "om_flagged_chat_new", chat_id: "oc_flagged", chat_name: "已标记项目群", chat_type: "group",
    create_time: "2026-08-14 10:05", content: "这里有新的处理进展", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let flagSyncs = 0;
  const created = [];
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30,
      allowedOpenId: "ou_me", monitorFlaggedConversations: true,
      flaggedConversationSyncIntervalMs: 300000, specialAttentionUsers: [],
    },
    state,
    lark: {
      async listFlaggedConversations() { flagSyncs += 1; return ["oc_flagged"]; },
      async searchMentions() { return []; },
      async searchSpecialAttentionMessages() { return []; },
      async searchDirectMessages() { return []; },
      async searchFlaggedConversationMessages(start, end, chatIds) {
        assert.deepEqual(chatIds, ["oc_flagged"]);
        return [flaggedMessage];
      },
      async getMentionContext(message) { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention(message) {
      created.push(message);
      return { taskId: "task_flagged", title: "【跟进】关注标记会话进展", urgencyLabel: "跟进", priority: 1, tags: ["飞书", "跟进"], relationshipSummary: "标记会话" };
    } },
  });

  await monitor.poll();
  assert.equal(state.state.mentionPending.length, 1);
  state.state.mentionPending[0].readyAt = "2026-08-14T00:00:00Z";
  await monitor.processLocalQueues();
  await monitor.poll();

  assert.equal(flagSyncs, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].intakeReasons, ["飞书标记会话"]);
  assert.deepEqual(state.state.flaggedConversationChatIds, ["oc_flagged"]);
});

test("derives latency from combined user attention signals without overriding explicit urgency", () => {
  const focused = deriveConversationAttention({
    sources: ["pinned", "feed_group"], feedGroups: [{ name: "AI方向" }], muted: false,
  });
  assert.equal(focused.tier, "high");
  assert.equal(focused.settleDelayMs, 10 * 60_000);
  assert.equal(focused.notificationMode, "digest");

  const muted = deriveConversationAttention({
    sources: ["feed_group"], feedGroups: [{ name: "斜杠" }], muted: true,
  });
  assert.equal(muted.tier, "low");
  assert.equal(muted.settleDelayMs, 30 * 60_000);
});

test("watches pinned and feed-group chats while carrying mute state into the decision", async () => {
  const message = {
    message_id: "om_attention", chat_id: "oc_attention", chat_name: "重点项目群", chat_type: "group",
    create_time: "2026-08-27 10:00", content: "项目有一项待确认变更", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  const decisions = [];
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30,
      allowedOpenId: "ou_me", flaggedConversationSyncIntervalMs: 300000,
      conversationAttentionSyncIntervalMs: 300000, specialAttentionUsers: [],
    },
    state,
    lark: {
      async listFlaggedConversations() { return []; },
      async listConversationAttentionSignals() {
        return {
          profiles: [{
            chatId: "oc_attention", chatName: "重点项目群", external: false,
            sources: ["pinned", "feed_group"], feedGroups: [{ id: "ofg_1", name: "任务", type: "normal" }],
            muted: true, muteAtAll: false,
          }],
          sourceErrors: [], inventory: { groupChats: 1 },
        };
      },
      async searchMentions() { return []; },
      async searchSpecialAttentionMessages() { return []; },
      async searchDirectMessages() { return []; },
      async searchAttentionConversationMessages(_start, _end, chatIds) {
        assert.deepEqual(chatIds, ["oc_attention"]);
        return [message];
      },
      async getMentionContext() { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention(candidate) { decisions.push(candidate); return { taskId: "", taskAction: "ignored" }; } },
  });

  await monitor.poll();
  assert.equal(state.state.mentionPending.length, 1);
  assert.equal(state.state.mentionPending[0].message.assistantAttention.notificationMode, "digest");
  assert.equal(state.state.mentionPending[0].message.assistantAttention.settleDelayMs, 15 * 60_000);
  assert.deepEqual(state.state.mentionPending[0].message.intakeReasons, [
    "飞书置顶会话", "飞书分组：任务", "群通知免打扰（降低打扰）",
  ]);
  assert.equal(decisions.length, 0);
});

test("keeps failed mentions pending with backoff", async () => {
  const message = { message_id: "om_2", chat_id: "oc_1", content: "@我 跟进", sender: { id: "ou_other" } };
  const state = stateHarness();
  const lark = {
    async searchMentions() { return [message]; },
    async getMentionContext() { return [message]; },
    async send() {},
  };
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state, lark, taskCreator: { async createFromMention() { throw new Error("network"); } },
  });
  await monitor.poll();
  assert.equal(state.state.mentionPending.length, 1);
  assert.equal(state.state.mentionPending[0].attempts, 1);
  assert.ok(state.state.mentionPending[0].nextAttemptAt);
});

test("aggregates sustained processing failures without forwarding raw message content", async () => {
  const state = stateHarness();
  state.state.mentionPending = [
    { message: { message_id: "om_1", content: "sensitive SQL" }, lastError: "timeout" },
    { message: { message_id: "om_2", content: "private context" }, lastError: "timeout" },
  ];
  const messages = [];
  const monitor = new MentionMonitor({
    config: {
      mentionProcessingFailureNotifyThreshold: 2,
      mentionProcessingFailureNotifyAfterMs: 0,
      notificationTimeZone: "Asia/Shanghai",
    },
    state,
    lark: { async send(message) { messages.push(message); } },
    taskCreator: {}, logger: { error() {} },
  });
  monitor.initializeState();

  await monitor.recordProcessingFailure(new Error("request timed out"), new Date("2026-08-25T01:00:00Z"));
  assert.equal(messages.length, 0);
  await monitor.recordProcessingFailure(new Error("request timed out"), new Date("2026-08-25T01:01:00Z"));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /累计失败：2 次/);
  assert.match(messages[0], /当前待处理：2 条/);
  assert.doesNotMatch(messages[0], /sensitive SQL|private context|om_1|om_2/);

  state.state.mentionPending = [];
  await monitor.recoverProcessingFailureIfIdle();
  assert.equal(messages.length, 2);
  assert.match(messages[1], /积压消息已处理完毕/);
  assert.equal(state.state.mentionProcessingFailure, null);
});

test("recognizes Feishu 9499 as rate limiting", () => {
  assert.equal(isLarkRateLimitError(new Error('{"error":{"code":9499,"message":"too many request"}}')), true);
  assert.equal(isLarkRateLimitError(new Error("request timed out")), false);
});

test("backs off transient Feishu rate limits without sending a generic failure alert", async () => {
  const state = stateHarness();
  let sends = 0;
  let searches = 0;
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, allowedOpenId: "ou_me",
      mentionRateLimitBaseMs: 120000, mentionRateLimitMaxMs: 1800000, mentionRateLimitNotifyAfterMs: 1800000,
    },
    state,
    lark: {
      async searchMentions() { searches += 1; throw new Error('{"error":{"code":9499,"message":"too many request"}}'); },
      async send() { sends += 1; },
    },
    taskCreator: {}, logger: { error() {} },
  });

  await monitor.poll();
  await monitor.poll();
  assert.equal(searches, 1);
  assert.equal(sends, 0);
  assert.equal(state.state.mentionHealthFailure, undefined);
  assert.equal(state.state.mentionRateLimitFailure.attempts, 1);
  assert.ok(new Date(state.state.mentionNextPollAt) > new Date());
});

test("silently clears a transient monitoring failure that never crossed the notification threshold", async () => {
  const state = stateHarness();
  let searchFails = true;
  const messages = [];
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, allowedOpenId: "ou_me",
      notificationTimeZone: "Asia/Shanghai", specialAttentionUsers: [],
    },
    state,
    lark: {
      async searchMentions() { if (searchFails) throw new Error("connection timeout"); return []; },
      async searchSpecialAttentionMessages() { return []; },
      async searchDirectMessages() { return []; },
      async searchFlaggedConversationMessages() { return []; },
      async send(message) { messages.push(message); },
    },
    taskCreator: {}, logger: { error() {} },
  });

  await monitor.poll();
  assert.ok(state.state.mentionHealthFailure);
  assert.equal(state.state.mentionHealthFailure.notifiedAt, null);
  searchFails = false;
  await monitor.poll();
  assert.equal(messages.length, 0);
  assert.equal(state.state.mentionHealthFailure, null);
});

test("runs independent focus-message searches sequentially", async () => {
  const state = stateHarness();
  let active = 0;
  let maxActive = 0;
  const search = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return [];
  };
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, allowedOpenId: "ou_me", specialAttentionUsers: [] },
    state,
    lark: {
      searchMentions: search, searchSpecialAttentionMessages: search,
      searchDirectMessages: search, searchFlaggedConversationMessages: search,
      async send() {},
    },
    taskCreator: {},
  });

  await monitor.poll();
  assert.equal(maxActive, 1);
});

test("recognizes only whole-message acknowledgements as low signal", () => {
  for (const content of ["ok", "OK!", "@常东旭 ok", "<at user_id=\"ou_me\">常东旭</at> 收到", "好的。", "明白了"]) {
    assert.equal(isLowSignalAcknowledgement(content), true, content);
  }
  for (const content of ["OK，但今天要发布", "好的，我今天处理", "收到客户反馈", "可以增加配额吗"]) {
    assert.equal(isLowSignalAcknowledgement(content), false, content);
  }
});

test("suppresses explicit synthetic test artifacts without hiding real test work", () => {
  for (const content of ["测试", "测试任务勿回", "test task", "smoke test ignore"]) {
    assert.equal(isSyntheticTestMessage(content), true, content);
  }
  for (const content of ["请测试 OpenAPI 配额", "test 环境发布失败", "验证测试结果"]) {
    assert.equal(isSyntheticTestMessage(content), false, content);
  }
});

test("waits for the conversation settle window before creating a task", async () => {
  const message = {
    message_id: "om_settle", chat_id: "oc_dm", chat_type: "p2p", create_time: "2026-08-22 10:00",
    content: "请批准配额申请", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let creates = 0;
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, mentionSettleDelayMs: 120000, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return []; }, async searchDirectMessages() { return [message]; },
      async getMentionContext() { return [message]; }, async send() {},
    },
    taskCreator: { async createFromMention() { creates += 1; return { taskAction: "ignored" }; } },
  });
  await monitor.poll();
  assert.equal(creates, 0);
  assert.equal(state.state.mentionPending.length, 1);
  state.state.mentionPending[0].readyAt = new Date(0).toISOString();
  await monitor.processPending();
  assert.equal(creates, 1);
});

test("lets contextual reasoning decide a new short acknowledgement", async () => {
  const message = {
    message_id: "om_ack", chat_id: "oc_dm", chat_type: "p2p", content: "ok",
    sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let creates = 0;
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return []; },
      async searchDirectMessages() { return [message]; },
      async getMentionContext() { return [{ content: "今天完成发布吗？" }, message]; },
      async send() { throw new Error("must remain silent"); },
    },
    taskCreator: { async createFromMention() {
      creates += 1;
      return { taskAction: "ignored", notificationDecision: "silent", researchDecision: "skip" };
    } },
  });

  await monitor.poll();
  assert.equal(creates, 1);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_ack"]);
  assert.equal(state.state.mentionPending.length, 0);
});

test("clears only synthetic fixture retries while retaining acknowledgements for reasoning", async () => {
  const state = stateHarness();
  state.state.mentionPending = [
    { message: { message_id: "om_test_fixture", content: "测试任务勿回" }, attempts: 5 },
    { message: { message_id: "om_stale_ack", content: "ok" }, attempts: 5 },
    { message: { message_id: "om_real", content: "OK，但今天要发布" }, attempts: 5 },
  ];
  const monitor = new MentionMonitor({ config: {}, state, lark: {}, taskCreator: {}, logger: { info() {} } });

  await monitor.discardLowSignalPending();
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_test_fixture"]);
  assert.deepEqual(state.state.mentionPending.map((item) => item.message.message_id), ["om_stale_ack", "om_real"]);
});

test("summarizes worker errors without leaking prompts into Feishu notifications", () => {
  const verbose = new Error(`滴答 MCP 执行失败（exit 1）：大量业务上下文和内部提示词\nERROR: {
    "error": { "message": "Invalid schema for response_format 'codex_output_schema': In context=('properties', 'tags'), 'uniqueItems' is not permitted." }
  }`);
  const summary = userFacingError(verbose);
  assert.match(summary, /输出格式校验失败/);
  assert.doesNotMatch(summary, /大量业务上下文|内部提示词/);
});

test("blocks all interaction in external groups and on unknown group metadata", async () => {
  const base = {
    config: {}, state: stateHarness(), taskCreator: {},
    lark: { async getChatInfo() { return { external: true }; } },
  };
  const monitor = new MentionMonitor(base);
  assert.equal((await monitor.interactionPolicy({ chat_type: "group", chat_id: "oc_1" })).allowed, false);
  base.lark.getChatInfo = async () => { throw new Error("offline"); };
  assert.equal((await monitor.interactionPolicy({ chat_type: "group", chat_id: "oc_1" })).allowed, false);
  assert.equal((await monitor.interactionPolicy({ chat_type: "p2p", chat_id: "oc_2" })).allowed, true);
});

test("asks the user before starting uncertain research", async () => {
  const message = {
    message_id: "om_confirm", chat_id: "oc_group", chat_name: "内部项目群", chat_type: "group",
    create_time: "2026-08-14 10:00", content: "@常东旭 同步一个可能的问题", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let researchStarts = 0;
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async send() {},
      async sendInteractive() { return { message_id: "question-1" }; },
    },
    taskCreator: { async createFromMention() {
      return {
        taskId: "task_confirm", title: "可能的问题", priority: 1, tags: [], relationshipSummary: "待判断",
        blacklakeRelated: true, researchDecision: "confirm", researchDecisionReason: "范围和收益不清楚", researchPrompt: "调查问题",
      };
    } },
    runner: { async create() { researchStarts += 1; } },
  });
  await monitor.poll();
  assert.equal(researchStarts, 0);
  assert.equal(state.state.mentionResearchConfirmations[0].status, "pending");
  assert.equal(state.state.mentionResearchConfirmations[0].questionMessageId, "question-1");
});

test("requires owner confirmation even for a high-value start recommendation", async () => {
  const message = {
    message_id: "om_start", chat_id: "oc_group", chat_name: "内部项目群", chat_type: "group",
    create_time: "2026-08-14 10:00", content: "@常东旭 生产客户阻塞", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  let researchStarts = 0;
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async sendInteractive() { return { message_id: "approval-start" }; },
    },
    taskCreator: { async createFromMention() {
      return { taskId: "task_start", title: "生产客户阻塞", blacklakeRelated: true,
        researchDecision: "start", researchDecisionReason: "高风险且需要证据", researchPrompt: "只读核验" };
    } },
    runner: { async create() { researchStarts += 1; } },
  });
  await monitor.poll();
  assert.equal(researchStarts, 0);
  assert.equal(state.state.mentionResearchConfirmations[0].status, "pending");
});

test("clarification is proposed to the owner before an approved AI twin card is sent", async () => {
  const message = {
    message_id: "om_clarify", chat_id: "oc_dm", chat_name: "姜臣轩", chat_type: "p2p",
    create_time: "2026-08-14 10:00", content: "加个字段", sender: { id: "ou_other", name: "姜臣轩" },
  };
  const state = stateHarness();
  const proposals = [];
  const replies = [];
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async sendInteractive(markdown, actions) { proposals.push({ markdown, actions }); return { message_id: "approval-clarify" }; },
      async replyAsUser(messageId, markdown, approval) { replies.push({ messageId, markdown, approval }); return { message_id: "om_question" }; },
    },
    taskCreator: { async createFromMention() {
      return { taskId: "task_clarify", title: "确认同步字段", taskAction: "created", notificationDecision: "silent",
        needsClarification: true, clarificationQuestion: "请确认目标对象和字段名。", researchDecision: "skip" };
    } },
  });
  await monitor.poll();
  assert.equal(proposals.length, 1);
  assert.equal(replies.length, 0);
  const pending = state.state.mentionClarificationConfirmations[0];
  const result = await monitor.applyClarificationDecision({
    type: "clarification_decision", sourceMessageId: message.message_id, approvalId: pending.approvalId, decision: "approve",
  });
  assert.equal(result.tone, "green");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].approval.approvalId, pending.approvalId);
  assert.match(replies[0].markdown, /目标对象和字段名/);
});

test("keeps repeated information silent when the existing task is unchanged", async () => {
  const message = {
    message_id: "om_repeat", chat_id: "oc_group", chat_name: "项目群", chat_type: "group",
    create_time: "2026-08-14 11:00", content: "还是按前面的方案处理", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  const sent = [];
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async send(text) { sent.push(text); },
    },
    taskCreator: { async createFromMention() {
      return {
        taskId: "task_existing", title: "【跟进】确认项目方案", taskAction: "unchanged", created: false,
        notificationDecision: "silent", notificationReason: "没有改变下一步", materialChangeSummary: "",
        urgencyLabel: "跟进", keyItem: false, priority: 1, tags: ["飞书", "跟进"],
        relationshipSummary: "已有任务覆盖", needsClarification: false, researchDecision: "skip", researchDecisionReason: "无需调研",
      };
    } },
  });

  await monitor.poll();
  assert.equal(sent.length, 0);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_repeat"]);
});

test("updates one existing task and only notifies for a material change", async () => {
  const message = {
    message_id: "om_update", chat_id: "oc_group", chat_name: "项目群", chat_type: "group",
    create_time: "2026-08-14 11:05", content: "客户要求提前到今天完成", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  const sent = [];
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async send(text) { sent.push(text); },
    },
    taskCreator: { async createFromMention() {
      return {
        taskId: "task_existing", title: "【紧急·关键】今天确认客户方案", taskAction: "updated", created: false,
        notificationDecision: "notify", notificationReason: "截止时间提前到今天", materialChangeSummary: "截止时间提前且优先级升高",
        notificationMode: "realtime", notificationDelayMinutes: 0, notificationTitle: "客户方案今天要定",
        ownerMessage: "客户把截止时间提前到今天了，我已经更新进原待办；现在需要你确认方案。", cardTone: "red",
        urgencyLabel: "紧急", keyItem: true, priority: 5, tags: ["飞书", "紧急", "关键事项"], dueDate: "2026-08-14",
        relationshipSummary: "需要常东旭确认", needsClarification: false, researchDecision: "skip", researchDecisionReason: "无需代码调研",
      };
    } },
  });

  await monitor.poll();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /我已经更新进原待办/);
  assert.match(sent[0], /截止时间提前且优先级升高/);
});

test("honors a model-selected digest delay before sending", async () => {
  const state = stateHarness();
  const sent = [];
  const monitor = new MentionMonitor({
    config: { digestNotificationStartHour: 0, digestNotificationEndHour: 24, notificationDigestMaxDelayMs: 6 * 60 * 60_000 },
    state, lark: { async send(text, suffix, options) { sent.push({ text, suffix, options }); } }, taskCreator: {},
  });
  await monitor.queueDigestNotification(
    { message_id: "om_adaptive", chat_id: "oc_1", chat_name: "项目群", sender: { name: "同事" } },
    { taskId: "task_adaptive", title: "【跟进】查看进展", notificationDelayMinutes: 15,
      notificationTitle: "进展我先帮你收着", ownerMessage: "这条更新不急，我先并到待办里。", cardTone: "grey" },
    "updated", { matches: [] }, new Date("2026-08-28T02:00:00Z"),
  );
  await monitor.flushNotificationDigest(new Date("2026-08-28T02:14:00Z"));
  assert.equal(sent.length, 0);
  await monitor.flushNotificationDigest(new Date("2026-08-28T02:15:00Z"));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /这条更新不急/);
  assert.equal(sent[0].options.tone, "grey");
});

test("batches ordinary notifications only after an enabled policy matches", async () => {
  const message = {
    message_id: "om_batch", chat_id: "oc_batch", chat_name: "普通项目群", chat_type: "group",
    create_time: "2026-08-23 10:00", content: "同步普通进展", sender: { id: "ou_other", name: "同事" },
  };
  const state = stateHarness();
  const sent = [];
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30,
      allowedOpenId: "ou_me", notificationDigestMaxDelayMs: 1,
    },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async send(text) { sent.push(text); },
    },
    policyManager: { async evaluatePolicies() {
      return { effect: { attention: "batch" }, matches: [{ id: "policy-batch" }] };
    } },
    taskCreator: { async createFromMention() {
      return {
        taskId: "task_batch", title: "【跟进】了解普通进展", taskAction: "updated",
        notificationDecision: "notify", materialChangeSummary: "进度更新", priority: 1,
        actionOwner: "other", researchDecision: "skip", tags: ["飞书"],
      };
    } },
  });

  await monitor.poll();
  assert.equal(sent.length, 0);
  assert.equal(state.state.notificationDigestPending.length, 1);
  state.state.notificationDigestPending[0].queuedAt = new Date(0).toISOString();
  await monitor.flushNotificationDigest(new Date("2026-08-23T11:00:00Z"));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /我把刚才几条不需要立刻打断你的信息合在一起了/);
  assert.equal(state.state.notificationDigestPending.length, 0);
});

test("does not turn Xiaowei agent replies into new automated tasks", async () => {
  const message = {
    message_id: "om_xiaowei", chat_id: "oc_xiaowei", chat_type: "p2p",
    content: "排查结果", sender: { id: "ou_xiaowei", name: "智造湖小维" },
  };
  const state = stateHarness();
  let creates = 0;
  const monitor = new MentionMonitor({
    config: {
      mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30,
      allowedOpenId: "ou_me", xiaoweiAgent: { openId: "ou_xiaowei" },
    },
    state,
    lark: {
      async searchMentions() { return []; },
      async searchDirectMessages() { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention() { creates += 1; } },
  });
  await monitor.poll();
  assert.equal(creates, 0);
});

test("does not let shadow observation failures block the official task pipeline", async () => {
  const message = {
    message_id: "om_shadow_failure", chat_id: "oc_1", chat_name: "项目群", chat_type: "group",
    create_time: "2026-08-20 10:00", content: "请确认方案", sender: { id: "ou_other" },
  };
  const state = stateHarness();
  const monitor = new MentionMonitor({
    config: { mentionInitialLookbackMinutes: 30, mentionOverlapMinutes: 2, mentionContextMinutes: 30, allowedOpenId: "ou_me" },
    state,
    lark: {
      async searchMentions() { return [message]; },
      async getMentionContext() { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention() {
      return { taskId: "task_1", taskAction: "created", notificationDecision: "silent", researchDecision: "skip" };
    } },
    shadowCollaboration: { async observe() { throw new Error("shadow offline"); } },
    logger: { error() {} },
  });
  await monitor.poll();
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_shadow_failure"]);
  assert.equal(state.state.mentionPending.length, 0);
});

test("accepts only an exact Ren Yongqiang membership event and registers the group as delegated", async () => {
  const state = stateHarness();
  const created = [];
  const monitor = new MentionMonitor({
    config: {
      allowedOpenId: "ou_me", ownerName: "常东旭", mentionContextMinutes: 30,
      delegationInviter: { name: "任永强", openId: "ou_ren" }, groupMembershipSettleDelayMs: 0,
    },
    state,
    lark: { async getMentionContext(message) { return [message]; }, async send() {} },
    taskCreator: { async createFromMention(message) {
      created.push(message);
      return { taskAction: "ignored", notificationDecision: "silent", researchDecision: "skip" };
    } },
  });

  assert.equal(await monitor.ingestMembershipAdded({
    header: { event_id: "evt_join", create_time: "1787443200000" },
    event: {
      chat_id: "oc_handoff", name: "客户交接群", external: false,
      operator_id: { open_id: "ou_ren" }, users: [{ user_id: { open_id: "ou_me" } }],
    },
  }), true);
  assert.equal(await monitor.ingestMembershipAdded({
    header: { event_id: "evt_other" },
    event: { chat_id: "oc_other", operator_id: { open_id: "ou_other" }, users: [{ user_id: { open_id: "ou_me" } }] },
  }), false);
  assert.deepEqual(state.state.delegatedGroupChatIds, ["oc_handoff"]);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].intakeReasons, ["任永强邀请入群：工作接手"]);
  assert.match(created[0].create_time, /^2026-/);
});

test("baselines existing groups and only promotes a new group with exact system-message evidence", async () => {
  const state = stateHarness();
  let chats = [{ chat_id: "oc_existing", name: "原有群" }];
  const created = [];
  const monitor = new MentionMonitor({
    config: {
      allowedOpenId: "ou_me", ownerName: "常东旭", mentionContextMinutes: 30,
      delegationInviter: { name: "任永强", openId: "ou_ren" },
      groupMembershipSyncIntervalMs: 1800000, groupMembershipSettleDelayMs: 0,
    },
    state,
    lark: {
      async listGroupChats() { return chats; },
      async getChatMessagesSince(chatId) {
        return chatId === "oc_handoff" ? [{
          message_id: "om_join", msg_type: "system", create_time: "2026-08-23T11:00:00+08:00",
          content: "任永强邀请常东旭加入了群聊",
        }] : [];
      },
      async getMentionContext(message) { return [message]; },
      async send() {},
    },
    taskCreator: { async createFromMention(message) {
      created.push(message);
      return { taskAction: "ignored", notificationDecision: "silent", researchDecision: "skip" };
    } },
  });

  const baselineAt = new Date("2026-08-23T10:00:00Z");
  await monitor.syncGroupMemberships(baselineAt);
  assert.equal(created.length, 0);
  chats = [...chats, { chat_id: "oc_handoff", name: "客户交接群", external: true }];
  await monitor.syncGroupMemberships(new Date("2026-08-23T10:31:00Z"));
  assert.equal(created.length, 1);
  assert.deepEqual(state.state.delegatedGroupChatIds, ["oc_handoff"]);
  assert.equal(created[0].external, true);
});

test("recognizes only system membership messages naming Ren and the owner", () => {
  assert.equal(isDelegationJoinSystemMessage({ msg_type: "system", content: "任永强邀请常东旭加入了群聊" }), true);
  assert.equal(isDelegationJoinSystemMessage({ msg_type: "text", content: "任永强邀请常东旭加入了群聊" }), false);
  assert.equal(isDelegationJoinSystemMessage({ msg_type: "system", content: "其他人邀请常东旭加入了群聊" }), false);
});

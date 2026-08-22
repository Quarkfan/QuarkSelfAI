import test from "node:test";
import assert from "node:assert/strict";
import { MentionMonitor, isLarkRateLimitError, isLowSignalAcknowledgement, isSyntheticTestMessage, userFacingError } from "../src/mention-monitor.js";

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
  await monitor.poll();

  assert.equal(flagSyncs, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].intakeReasons, ["飞书标记会话"]);
  assert.deepEqual(state.state.flaggedConversationChatIds, ["oc_flagged"]);
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

test("silently marks new low-signal messages processed without calling the task worker", async () => {
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
      async send() { throw new Error("must remain silent"); },
    },
    taskCreator: { async createFromMention() { creates += 1; } },
  });

  await monitor.poll();
  assert.equal(creates, 0);
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_ack"]);
  assert.equal(state.state.mentionPending.length, 0);
});

test("clears stale low-signal retries while retaining real pending work", async () => {
  const state = stateHarness();
  state.state.mentionPending = [
    { message: { message_id: "om_stale_ack", content: "ok" }, attempts: 5 },
    { message: { message_id: "om_real", content: "OK，但今天要发布" }, attempts: 5 },
  ];
  const monitor = new MentionMonitor({ config: {}, state, lark: {}, taskCreator: {}, logger: { info() {} } });

  await monitor.discardLowSignalPending();
  assert.deepEqual(state.state.mentionProcessedMessageIds, ["om_stale_ack"]);
  assert.deepEqual(state.state.mentionPending.map((item) => item.message.message_id), ["om_real"]);
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
        urgencyLabel: "紧急", keyItem: true, priority: 5, tags: ["飞书", "紧急", "关键事项"], dueDate: "2026-08-14",
        relationshipSummary: "需要常东旭确认", needsClarification: false, researchDecision: "skip", researchDecisionReason: "无需代码调研",
      };
    } },
  });

  await monitor.poll();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /更新了已有自动化待办/);
  assert.match(sent[0], /截止时间提前且优先级升高/);
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

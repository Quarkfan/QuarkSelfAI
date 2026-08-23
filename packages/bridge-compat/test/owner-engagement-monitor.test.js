import test from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, extractReactionRecords, OwnerEngagementMonitor } from "../src/owner-engagement-monitor.js";

function harness(overrides = {}) {
  const state = {
    state: { processedMessageIds: [] },
    async save() {},
  };
  const enqueued = [];
  const ownerSignals = [];
  const monitor = new OwnerEngagementMonitor({
    config: {
      allowedOpenId: "ou_me", ownerName: "常东旭", ownerEngagementBusinessDays: 3,
      ownerEngagementSettleDelayMs: 0, reactionSettleDelayMs: 0,
      ...overrides.config,
    },
    state,
    lark: overrides.lark || {},
    mentionMonitor: { async enqueueSignal(message, delay) { enqueued.push({ message, delay }); return true; } },
    collaborationLearning: { async recordOwnerSignal(signal) { ownerSignals.push(signal); } },
    logger: { error() {} },
  });
  return { monitor, state, enqueued, ownerSignals };
}

test("adds engagement expiry in business days", () => {
  assert.equal(addBusinessDays(new Date("2026-08-21T10:00:00Z"), 3).toISOString(), "2026-08-26T10:00:00.000Z");
  assert.equal(addBusinessDays(new Date("2026-08-23T17:00:00Z"), 1).toISOString(), "2026-08-24T17:00:00.000Z"); // Tuesday in Shanghai
});

test("extracts reaction detail records without interpreting emoji semantics", () => {
  const records = extractReactionRecords({ details: [{
    message_id: "om_1",
    message_reaction_items: [{
      reaction_id: "r1", operator: { operator_id: "ou_me", operator_type: "user" },
      action_time: "1787443200000", emoji_type: "OnIt",
    }],
  }] });
  assert.deepEqual(records, [{
    operatorId: "ou_me", operatorType: "user", emojiType: "OnIt",
    actionTime: "1787443200000", reactionId: "r1",
  }]);
});

test("tracks low-signal owner participation but only queues substantive work communication", async () => {
  const h = harness();
  const base = {
    chat_id: "oc_work", chat_name: "项目群", chat_type: "group",
    sender: { id: "ou_me", name: "常东旭" }, create_time: "2026-08-23T09:00:00Z",
  };
  assert.equal(await h.monitor.recordOwnerMessage({ ...base, message_id: "om_ok", content: "好的" }, new Date("2026-08-23T09:00:00Z")), true);
  assert.equal(h.enqueued.length, 0);
  assert.equal(h.state.state.ownerEngagedConversations.length, 1);
  assert.equal(await h.monitor.recordOwnerMessage({ ...base, message_id: "om_commit", content: "我明天给出处理方案" }, new Date("2026-08-23T09:01:00Z")), true);
  assert.equal(h.enqueued.length, 1);
  assert.deepEqual(h.enqueued[0].message.intakeReasons, ["本人主动参与工作沟通"]);
  assert.equal(h.ownerSignals.filter((item) => item.type === "business_participation").length, 2);
});

test("keeps bot-control messages and Xiaowei requests out of owner business participation", async () => {
  const h = harness({ config: { xiaoweiAgent: { chatId: "oc_xiaowei" } } });
  h.state.state.processedMessageIds.push("om_control");
  const message = { chat_type: "p2p", sender: { id: "ou_me" }, content: "执行", create_time: "2026-08-23T09:00:00Z" };
  assert.equal(await h.monitor.recordOwnerMessage({ ...message, message_id: "om_control", chat_id: "oc_bot" }), false);
  assert.equal(await h.monitor.recordOwnerMessage({ ...message, message_id: "om_xiaowei", chat_id: "oc_xiaowei" }), false);
  assert.equal(h.enqueued.length, 0);
});

test("excludes the owner's bot control chat even before direct-message idempotency catches up", async () => {
  const h = harness({ config: { ownerControlChatIds: ["oc_control"] } });
  assert.equal(await h.monitor.recordOwnerMessage({
    message_id: "om_health", chat_id: "oc_control", chat_type: "p2p",
    content: "健康检查一下", sender: { id: "ou_me" },
  }), false);
  assert.equal(h.enqueued.length, 0);
});

test("durably resolves owner reactions and reactions to owner messages", async () => {
  const targets = new Map([
    ["om_other", { message_id: "om_other", chat_id: "oc_work", chat_type: "group", content: "请确认方案", sender: { id: "ou_other", name: "同事" } }],
    ["om_owner", { message_id: "om_owner", chat_id: "oc_work", chat_type: "group", content: "请你推进", sender: { id: "ou_me", name: "常东旭" } }],
    ["om_irrelevant", { message_id: "om_irrelevant", chat_id: "oc_work", chat_type: "group", content: "闲聊", sender: { id: "ou_other" } }],
  ]);
  const h = harness({ lark: { async getMessagesByIds(ids) { return [targets.get(ids[0])]; } } });
  const event = (id, messageId, operatorId, emoji = "OK") => ({
    header: { event_id: id, create_time: "1787443200000" },
    event: { message_id: messageId, operator_type: "user", user_id: { open_id: operatorId }, reaction_type: { emoji_type: emoji }, action_time: "1787443200000" },
  });
  assert.equal(await h.monitor.ingestReaction(event("evt_owner", "om_other", "ou_me", "THUMBSUP"), "created"), true);
  assert.equal(await h.monitor.ingestReaction(event("evt_other", "om_owner", "ou_other", "OnIt"), "created"), true);
  assert.equal(await h.monitor.ingestReaction(event("evt_noise", "om_irrelevant", "ou_other", "SMILE"), "created"), true);
  assert.equal(h.enqueued.length, 2);
  assert.deepEqual(h.enqueued.map((item) => item.message.intakeReasons[0]), ["本人表情回应", "他人回应本人消息"]);
  assert.equal(h.state.state.reactionProcessedEventIds.length, 3);
  assert.equal(h.ownerSignals.some((item) => item.type === "reaction" && item.emojiType === "THUMBSUP"), true);
  assert.equal(await h.monitor.ingestReaction(event("evt_owner", "om_other", "ou_me"), "created"), false);
});

test("treats reaction deletion as reevaluation instead of a fixed negative meaning", async () => {
  const h = harness({ lark: { async getMessagesByIds() {
    return [{ message_id: "om_owner", chat_id: "oc_work", chat_type: "group", content: "安排事项", sender: { id: "ou_me" } }];
  } } });
  await h.monitor.ingestReaction({
    header: { event_id: "evt_deleted" },
    event: { message_id: "om_owner", operator_type: "user", user_id: { open_id: "ou_other" }, reaction_type: { emoji_type: "OK" } },
  }, "deleted");
  assert.deepEqual(h.enqueued[0].message.intakeReasons, ["他人回应本人消息", "表情撤回"]);
  assert.match(h.enqueued[0].message.content, /不得使用固定 emoji 字典/);
});

test("polls owner activity and reaction fallback on a bounded interval", async () => {
  let ownerSearches = 0;
  let engagedSearches = 0;
  let engagedWindow = null;
  const ownerMessage = {
    message_id: "om_owner", chat_id: "oc_work", chat_name: "项目群", chat_type: "group",
    content: "我来处理", sender: { id: "ou_me" }, create_time: "2026-08-23T09:00:00Z",
  };
  const h = harness({
    config: { ownerEngagementPollIntervalMs: 1800000 },
    lark: {
      async searchOwnerMessages() { ownerSearches += 1; return [ownerMessage]; },
      async searchEngagedConversationMessages(start, end) {
        engagedSearches += 1;
        engagedWindow = { start, end };
        return [];
      },
    },
  });
  const now = new Date("2026-08-23T09:10:00Z");
  await h.monitor.poll(now);
  await h.monitor.poll(new Date("2026-08-23T09:20:00Z"));
  assert.equal(ownerSearches, 1);
  assert.equal(engagedSearches, 1);
  assert.deepEqual(engagedWindow, {
    start: "2026-08-22T17:10:00+08:00",
    end: "2026-08-23T17:10:00+08:00",
  });
  assert.equal(h.state.state.ownerEngagementHealthFailure, null);
});

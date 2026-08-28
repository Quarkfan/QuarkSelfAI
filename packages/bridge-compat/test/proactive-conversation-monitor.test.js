import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProactiveConversationContext,
  ProactiveConversationMonitor,
  validateProactiveConversationDecision,
} from "../src/proactive-conversation-monitor.js";

function harness(decision) {
  const sent = [];
  const state = { state: {}, saves: 0, async save() { this.saves += 1; } };
  const monitor = new ProactiveConversationMonitor({
    config: {
      proactiveConversationEnabled: true,
      proactiveConversationMinimumCooldownMs: 48 * 60 * 60_000,
      proactiveConversationAnswerWindowMs: 72 * 60 * 60_000,
      proactiveConversationStartHour: 9,
      proactiveConversationEndHour: 19,
      proactiveConversationTimeZone: "Asia/Shanghai",
    },
    state,
    lark: { async sendInput(...args) { sent.push(args); return { message_id: "om_question" }; } },
    planner: async () => decision,
    logger: { error() {} },
  });
  return { monitor, state, sent };
}

const askDecision = {
  decision: "ask", question: "遇到别人只发进度同步时，你通常希望我在什么情况下把它变成待办？",
  reason: "近期这类消息容易在知悉和行动之间误判", answerUse: "以后更准确地区分同步与责任",
  knowledgeKey: "task_admission.progress_update", cardTitle: "想更懂你的处理习惯", cardTone: "blue",
  valueScore: 88, revisitAfterHours: 72,
};

test("asks one high-value question and persists an owner-stated answer", async () => {
  const h = harness(askDecision);
  const now = new Date("2026-08-28T02:00:00Z");
  await h.monitor.poll(now);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0][1].submitName, "proactive_learning_submit");
  assert.equal(h.state.state.proactiveConversation.questions[0].messageId, "om_question");
  const answered = await h.monitor.recordAnswer("如果没有我明确承担的下一步，就先不要建。", { source: "card" }, new Date("2026-08-28T02:05:00Z"));
  assert.equal(answered.status, "answered");
  assert.equal(h.state.state.collaborationLearning.proactiveInsights[0].status, "owner-stated");
  assert.match(h.state.state.collaborationLearning.proactiveInsights[0].answer, /不要建/);
});

test("does not ask again while a question is pending or inside cooldown", async () => {
  const h = harness(askDecision);
  const now = new Date("2026-08-28T02:00:00Z");
  await h.monitor.poll(now);
  h.state.state.proactiveConversation.nextEvaluateAt = null;
  await h.monitor.poll(new Date("2026-08-29T02:00:00Z"));
  assert.equal(h.sent.length, 1);
  await h.monitor.recordAnswer("先静默", {}, new Date("2026-08-29T02:01:00Z"));
  h.state.state.proactiveConversation.nextEvaluateAt = null;
  await h.monitor.poll(new Date("2026-08-30T01:00:00Z"));
  assert.equal(h.sent.length, 1);
});

test("keeps low-value or malformed questions silent", async () => {
  assert.throws(() => validateProactiveConversationDecision({ ...askDecision, valueScore: 60 }), /低价值/);
  assert.throws(() => validateProactiveConversationDecision({ ...askDecision, answerUse: "自动更新到策略配置中" }), /不得承诺/);
  const h = harness({
    decision: "skip", question: "", reason: "现在没有值得打扰的问题", answerUse: "", knowledgeKey: "",
    cardTitle: "", cardTone: "grey", valueScore: 20, revisitAfterHours: 48,
  });
  await h.monitor.poll(new Date("2026-08-28T02:00:00Z"));
  assert.equal(h.sent.length, 0);
  assert.ok(h.state.state.proactiveConversation.nextEvaluateAt);
});

test("builds bounded context without exposing the whole state", () => {
  const context = buildProactiveConversationContext({
    ownerConversation: Array.from({ length: 20 }, (_, index) => ({ content: `消息 ${index}`, receivedAt: `2026-08-${index + 1}` })),
    collaborationLearning: { observations: [], proactiveInsights: [] },
    secretToken: "must-not-leak",
  }, new Date("2026-08-28T02:00:00Z"));
  assert.equal(context.recentConversation.length, 12);
  assert.equal(JSON.stringify(context).includes("must-not-leak"), false);
});

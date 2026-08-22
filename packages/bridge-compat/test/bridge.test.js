import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../src/bridge.js";

function createHarness(matches) {
  const controller = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", title: "飞书总控", updatedAt: "2026-08-21" };
  const replies = [];
  const sends = [];
  const state = {
    state: { controllerSessionId: controller.id, currentSessionId: controller.id, lastCandidates: [], pendingPrompt: null, queue: [], processedMessageIds: [] },
    hasProcessed(id) { return this.state.processedMessageIds.includes(id); },
    async markProcessed(id) { this.state.processedMessageIds.push(id); },
    async save() {},
  };
  const sessions = {
    async find() { return matches; },
    async get(id) { return [controller, ...matches].find((item) => item.id === id) ?? null; },
    isLocked() { return false; },
  };
  const lark = {
    async reply(id, text) { replies.push({ id, text }); },
    async replyInput(id, text) { replies.push({ id, text }); },
    async replySelection(id, text) { replies.push({ id, text }); },
    async send(text) { sends.push(text); },
    async updateCard() {},
  };
  const runner = {
    running: new Map(),
    isRunning() { return false; },
    async execute() { return "执行成功"; },
    async create() { return { sessionId: matches[0]?.id, final: "新会话完成" }; },
  };
  const bridge = new Bridge({
    config: { allowedOpenId: "ou_me", maxCandidates: 5, intentAsyncRouting: false }, sessions, state, lark, runner,
  });
  return { bridge, state, replies, sends };
}

function event(id, content) {
  return { message_id: id, content, sender_id: "ou_me", sender_type: "user", chat_type: "p2p", message_type: "text" };
}

test("ignores other senders and duplicate messages", async () => {
  const harness = createHarness([]);
  await harness.bridge.handle({ ...event("m1", "帮助"), sender_id: "ou_other" });
  assert.equal(harness.replies.length, 0);
  await harness.bridge.handle(event("m1", "帮助"));
  await harness.bridge.handle(event("m1", "帮助"));
  assert.equal(harness.replies.length, 1);
});

test("natural create wording is delegated to Codex instead of intercepted by an enum router", async () => {
  const created = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", title: "新任务", updatedAt: "2026-08-13" };
  const harness = createHarness([created]);
  let executed = null;
  let createCalls = 0;
  harness.bridge.runner.execute = async (job) => { executed = job; return "已由总控处理"; };
  harness.bridge.runner.create = async () => { createCalls += 1; return { sessionId: created.id, final: "新会话完成" }; };
  await harness.bridge.handle(event("m-create", "新开一个对话调查新问题"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 0);
  assert.equal(executed.prompt, "新开一个对话调查新问题");
  assert.equal(executed.controller, true);
});

test("authorized private messages go directly to the Codex controller", async () => {
  const harness = createHarness([]);
  let executed = null;
  harness.bridge.runner.execute = async (job) => { executed = job; return "完成"; };
  await harness.bridge.handle(event("m-codex-intent", "帮助"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executed.prompt, "帮助");
  assert.equal(executed.sessionId, harness.state.state.controllerSessionId);
  assert.deepEqual(harness.state.state.processedMessageIds, ["m-codex-intent"]);
});

test("retains a private message when direct Codex execution is temporarily unavailable", async () => {
  const harness = createHarness([]);
  harness.bridge.config.sessionRetryBaseMs = 30_000;
  harness.bridge.runner.execute = async () => { throw new Error("network unavailable"); };
  harness.bridge.logger = { error() {} };
  await harness.bridge.handle(event("m-intent-retry", "处理一下当前问题"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.state.state.queue.length, 1);
  assert.equal(harness.state.state.queue[0].attempts, 1);
  assert.equal(harness.state.state.processedMessageIds.includes("m-intent-retry"), true);
  assert.match(harness.replies[0].text, /Codex 总控/);
});

test("session-targeting language is preserved for the Codex controller to resolve", async () => {
  const matches = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "对象任务 A", updatedAt: "2026-08-13" },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "对象任务 B", updatedAt: "2026-08-12" },
  ];
  const harness = createHarness(matches);
  let executed = null;
  harness.bridge.runner.execute = async (job) => { executed = job; return "完成"; };
  await harness.bridge.handle(event("m1", "对 对象 session：检查测试"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executed.prompt, "对 对象 session：检查测试");
  assert.equal(executed.sessionId, harness.state.state.controllerSessionId);
  assert.equal(harness.state.state.pendingPrompt, null);
});

test("records a natural-language research confirmation without treating it as a session prompt", async () => {
  const harness = createHarness([]);
  harness.state.state.mentionResearchConfirmations = [{
    questionMessageId: "question-1",
    status: "pending",
    task: { taskId: "task-1", title: "客户性能问题", researchDecision: "confirm", researchDecisionReason: "范围较大" },
  }];
  harness.state.state.researchDecisionHistory = [];
  await harness.bridge.handle({ ...event("m-confirm", "可以调研"), reply_to: "question-1" });
  assert.equal(harness.state.state.mentionResearchConfirmations[0].status, "approved");
  assert.match(harness.replies.at(-1).text, /使用 Codex 调研/);
  assert.deepEqual(harness.state.state.queue, []);
});

test("learns from a decision to skip research", async () => {
  const harness = createHarness([]);
  harness.state.state.mentionResearchConfirmations = [{
    questionMessageId: "question-2",
    status: "pending",
    task: { taskId: "task-2", title: "普通同步", researchDecision: "confirm", researchDecisionReason: "价值不确定" },
  }];
  harness.state.state.researchDecisionHistory = [];
  await harness.bridge.handle({ ...event("m-decline", "这个先不用调研"), reply_to: "question-2" });
  assert.equal(harness.state.state.mentionResearchConfirmations[0].status, "declined");
  assert.equal(harness.state.state.researchDecisionHistory[0].finalDecision, "skip");
});

test("handles a research decision from an interactive card once", async () => {
  const harness = createHarness([]);
  harness.state.state.processedCardEventIds = [];
  harness.state.state.mentionResearchConfirmations = [{
    sourceMessageId: "source-1",
    status: "pending",
    task: { taskId: "task-3", title: "卡片调研", researchDecision: "confirm", researchDecisionReason: "需确认" },
  }];
  harness.state.state.researchDecisionHistory = [];
  const action = {
    event_id: "event-1", operator_id: "ou_me", token: "token-1", message_id: "card-1",
    action_value: JSON.stringify({ type: "research_decision", sourceMessageId: "source-1", decision: "approve" }),
  };
  await harness.bridge.handleCardAction(action);
  await harness.bridge.handleCardAction(action);
  assert.equal(harness.state.state.mentionResearchConfirmations[0].status, "approved");
  assert.deepEqual(harness.state.state.processedCardEventIds, ["event-1"]);
});

test("delegates follow-up card actions and deduplicates the callback", async () => {
  const harness = createHarness([]);
  harness.state.state.processedCardEventIds = [];
  let handled = 0;
  harness.bridge.followupManager = { async handleCardAction() { handled += 1; } };
  const action = {
    event_id: "followup-event-1", operator_id: "ou_me", token: "token-2", message_id: "card-2",
    action_value: JSON.stringify({ type: "followup_outreach_decision", requestId: "req-1", decision: "approve" }),
  };
  await harness.bridge.handleCardAction(action);
  await harness.bridge.handleCardAction(action);
  assert.equal(handled, 1);
  assert.deepEqual(harness.state.state.processedCardEventIds, ["followup-event-1"]);
});

test("retains transient session failures and retries without losing the request", async () => {
  const session = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "协作会话", updatedAt: "2026-08-14" };
  const harness = createHarness([session]);
  harness.bridge.config.sessionRetryBaseMs = 1;
  harness.bridge.config.sessionRetryMaxMs = 1;
  let attempts = 0;
  harness.bridge.runner.execute = async (job) => {
    attempts += 1;
    if (attempts === 1) throw new Error("request timed out");
    job.executor = "claude";
    return "重试完成";
  };
  harness.state.state.queue.push({
    id: "retry-1", sessionId: session.id, sessionTitle: session.title, prompt: "继续处理",
  });

  await harness.bridge.drain();
  assert.equal(harness.state.state.queue.length, 1);
  assert.equal(harness.state.state.queue[0].attempts, 1);
  assert.equal(harness.state.state.queue[0].requestedExecutor, "codex");
  assert.equal(harness.state.state.queue[0].failureReason, "retryable_transient");
  assert.equal(harness.state.state.queue[0].failureStage, "会话执行");
  harness.state.state.queue[0].nextAttemptAt = new Date(0).toISOString();
  await harness.bridge.drain();

  assert.equal(attempts, 2);
  assert.equal(harness.state.state.queue.length, 0);
  assert.match(harness.sends.at(-1), /重试完成/);
  assert.match(harness.sends.at(-1), /Codex -> Claude Code 兜底/);
  assert.equal(harness.state.state.executionHistory.at(-1).actualExecutor, "claude");
});

test("keeps a completed result until Lark delivery succeeds", async () => {
  const session = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "协作会话", updatedAt: "2026-08-14" };
  const harness = createHarness([session]);
  harness.bridge.config.sessionRetryBaseMs = 1;
  harness.bridge.config.sessionRetryMaxMs = 1;
  let deliveries = 0;
  harness.bridge.lark.send = async (text) => {
    if (/处理完成/.test(text) && deliveries++ === 0) throw new Error("network connection reset");
    harness.sends.push(text);
  };
  harness.state.state.queue.push({
    id: "delivery-1", sessionId: session.id, sessionTitle: session.title, prompt: "继续处理",
  });

  await harness.bridge.drain();
  assert.equal(harness.state.state.queue.length, 1);
  assert.equal(harness.state.state.queue[0].finalResult, "执行成功");
  assert.equal(harness.state.state.queue[0].failureReason, "result_delivery");
  assert.equal(harness.state.state.queue[0].failureStage, "结果回传");
  harness.state.state.queue[0].nextAttemptAt = new Date(0).toISOString();
  await harness.bridge.drain();

  assert.equal(harness.state.state.queue.length, 0);
  assert.match(harness.sends.at(-1), /执行成功/);
});

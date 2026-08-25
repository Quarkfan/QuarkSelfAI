import test from "node:test";
import assert from "node:assert/strict";
import { CollaborationLearningMonitor } from "../src/collaboration-learning.js";

function harness(overrides = {}) {
  const sent = [];
  const briefs = [];
  const proposals = [];
  const state = { state: {}, async save() {} };
  const monitor = new CollaborationLearningMonitor({
    config: {
      collaborationLearningEnabled: true,
      collaborationLearningIntervalMs: 0,
      collaborationLearningMinimumSamples: 20,
      collaborationLearningMinimumScopeSamples: 8,
      collaborationLearningProposalCooldownMs: 604800000,
      ...overrides,
    },
    state,
    lark: {
      async sendInteractive(...args) { sent.push(args); return { message_id: "om_card" }; },
      async send(...args) { briefs.push(args); return { message_id: "om_brief" }; },
    },
    policyManager: { async proposePolicy(sourceText, document) {
      proposals.push({ sourceText, document });
      return {
        id: "policy-1", revision: 1,
        simulation: { safeToActivate: true, matchedCount: 20, urgentSuppressedCount: 0 },
      };
    } },
    logger: { error() {} },
  });
  return { monitor, state, sent, briefs, proposals };
}

function message(index, extra = {}) {
  return {
    message_id: `om_${index}`, chat_id: "oc_repeated", chat_name: "普通协作群",
    content: `业务同步 ${index}`, sender: { id: "ou_sender", name: "同事" }, intakeReasons: ["飞书标记会话"],
    ...extra,
  };
}

function ordinaryTask() {
  return {
    taskId: "task-1", taskAction: "updated", notificationDecision: "notify", priority: 1,
    actionRequired: false, actionOwner: "other", researchDecision: "skip", materialChangeSummary: "普通进展",
  };
}

test("stores privacy-bounded collaboration observations", async () => {
  const h = harness();
  await h.monitor.observe(message(1), ordinaryTask(), new Date("2026-08-23T00:00:00Z"));
  const observation = h.state.state.collaborationLearning.observations[0];
  assert.equal(observation.chatId, "oc_repeated");
  assert.equal(observation.difference, "could_batch");
  assert.equal("content" in observation, false);
  assert.equal("title" in observation, false);
});

test("turns matching interaction history into non-binding privacy-bounded guidance", async () => {
  const h = harness();
  const signal = {
    type: "reaction",
    operation: "created",
    emojiType: "THUMBSUP",
    ownerOperated: true,
  };
  await h.monitor.observe(message(1, { collaborationSignal: signal }), {
    ...ordinaryTask(), taskAction: "created", actionOwner: "changdongxu",
  });
  await h.monitor.observe(message(2, { collaborationSignal: signal }), {
    ...ordinaryTask(), taskAction: "ignored", notificationDecision: "silent",
  });
  const guidance = h.monitor.guidanceFor(message(3, { collaborationSignal: signal }));
  assert.match(guidance, /同类脱敏样本 2 条/);
  assert.match(guidance, /建单 1、更新 0、忽略 1/);
  assert.match(guidance, /即时通知 1、静默 1/);
  assert.equal(guidance.includes("业务同步"), false);
  assert.match(h.monitor.guidanceFor(message(4)), /当前上下文保守判断/);
});

test("proposes one exact-scope batching policy only after repeated safe evidence", async () => {
  const h = harness();
  for (let index = 0; index < 20; index += 1) {
    await h.monitor.observe(message(index), ordinaryTask(), new Date(`2026-08-23T00:${String(index).padStart(2, "0")}:00Z`));
  }
  await h.monitor.poll(new Date("2026-08-24T00:00:00Z"));
  assert.equal(h.proposals.length, 1);
  assert.deepEqual(h.proposals[0].document.when, { fact: "source.chatId", op: "eq", value: "oc_repeated" });
  assert.deepEqual(h.proposals[0].document.effect, { attention: "batch" });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0][2].includeInput, true);
  assert.equal(h.state.state.collaborationLearning.candidates[0].status, "proposed");
  await h.monitor.poll(new Date("2026-08-25T00:00:00Z"));
  assert.equal(h.proposals.length, 1);
});

test("does not propose suppression when the cohort contains protected messages", async () => {
  const h = harness();
  for (let index = 0; index < 20; index += 1) {
    const task = ordinaryTask();
    if (index === 19) task.approvalRequired = true;
    await h.monitor.observe(message(index), task, new Date(`2026-08-23T00:${String(index).padStart(2, "0")}:00Z`));
  }
  await h.monitor.poll(new Date("2026-08-24T00:00:00Z"));
  assert.equal(h.proposals.length, 0);
  assert.equal(h.sent.length, 0);
});

test("records owner continuity and policy decisions as learning signals", async () => {
  const h = harness();
  await h.monitor.recordOwnerMessage({
    message_id: "om_owner", content: "不对，改成十分钟", reply_to: "om_previous",
  });
  h.state.state.collaborationLearning.candidates.push({ policyId: "policy-1", status: "proposed" });
  await h.monitor.recordOwnerSignal({ type: "policy_decision", policyId: "policy-1", decision: "decline" });
  const [messageSignal] = h.state.state.collaborationLearning.ownerSignals;
  assert.equal(messageSignal.explicitReply, true);
  assert.equal(messageSignal.correctionCue, true);
  assert.equal(h.state.state.collaborationLearning.candidates[0].status, "declined");
});

test("sends one concise daily review and does not duplicate it after another poll", async () => {
  const h = harness({ collaborationLearningMinimumSamples: 100 });
  await h.monitor.observe(message(1), ordinaryTask(), new Date("2026-08-24T00:00:00Z"));
  await h.monitor.poll(new Date("2026-08-25T00:00:00Z"));
  await h.monitor.poll(new Date("2026-08-25T01:00:00Z"));
  assert.equal(h.briefs.length, 1);
  assert.match(h.briefs[0][0], /任务判断/);
  assert.match(h.briefs[0][0], /可能打扰/);
  assert.equal(h.state.state.collaborationLearning.reviews.length, 1);
});

test("auto-tunes only repeated safe quiet signals and feeds the result back into guidance", async () => {
  const h = harness({ collaborationLearningMinimumSamples: 100, collaborationAutoTuneMinimumSamples: 8 });
  const signal = { type: "reaction", operation: "created", emojiType: "THUMBSUP", ownerOperated: true };
  for (let index = 0; index < 8; index += 1) {
    await h.monitor.observe(message(index, { collaborationSignal: signal }), {
      ...ordinaryTask(), taskAction: "ignored", notificationDecision: "silent",
    }, new Date(`2026-08-24T00:0${index}:00Z`));
  }
  await h.monitor.poll(new Date("2026-08-25T00:00:00Z"));
  assert.equal(h.state.state.collaborationLearning.guidanceProfiles.length, 1);
  assert.match(h.monitor.guidanceFor(message(9, { collaborationSignal: signal })), /每日回顾已自动校准/);
  assert.match(h.briefs[0][0], /普通确认信号默认降噪/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ShadowCollaborationMonitor,
  buildShadowDecision,
  classifyAttention,
  compactShadowHistory,
  detectTaskFeedback,
} from "../src/shadow-collaboration.js";

function harness(overrides = {}) {
  const state = {
    state: {},
    async save() {},
  };
  const config = {
    shadowCollaborationEnabled: true,
    shadowCollaborationDays: 7,
    shadowCalendarPollIntervalMs: 1800000,
    shadowTaskFeedbackPollIntervalMs: 21600000,
    didaProjectId: "todo",
    followupProjectId: "followup",
    varDir: os.tmpdir(),
    ...overrides,
  };
  const lark = { async listAgenda() { return []; }, async send() {} };
  return { state, config, lark };
}

test("classifies only urgent or near-term important work as realtime", () => {
  const now = new Date("2026-08-20T10:00:00Z");
  assert.equal(classifyAttention({ priority: 5 }, now), "realtime");
  assert.equal(classifyAttention({ priority: 3, dueDate: "2026-08-20T12:00:00Z" }, now), "realtime");
  assert.equal(classifyAttention({ priority: 1, actionRequired: true, actionOwner: "changdongxu" }, now), "today");
  assert.equal(classifyAttention({ priority: 0, notificationDecision: "silent" }, now), "silent");
});

test("marks ordinary notifications as batchable instead of realtime", () => {
  const decision = buildShadowDecision({ message_id: "om_1", chat_name: "项目群" }, {
    taskId: "task_1", taskAction: "created", notificationDecision: "notify",
    priority: 1, actionRequired: true, actionOwner: "changdongxu", nextAction: "确认方案",
  }, new Date("2026-08-20T10:00:00Z"));
  assert.equal(decision.attentionTier, "today");
  assert.equal(decision.recommendedNotification, "daily_digest");
  assert.equal(decision.difference, "could_batch");
});

test("merges repeated messages into one matter without storing raw content", async () => {
  const h = harness();
  const monitor = new ShadowCollaborationMonitor(h);
  const base = {
    chat_id: "oc_1", chat_name: "人脸OpenApi", chat_type: "group",
    sender: { id: "ou_1", name: "同事" }, create_time: "2026-08-20 10:00",
    content: "user-domain 两个人脸 OpenAPI 准备发布",
  };
  const task = {
    taskId: "task_1", taskAction: "created", title: "【重要】发布 user-domain 人脸 OpenAPI",
    priority: 3, notificationDecision: "notify", actionRequired: true,
    actionOwner: "shared", nextAction: "确认发布结果",
  };
  await monitor.observe({ ...base, message_id: "om_1" }, [base], task);
  await monitor.observe({ ...base, message_id: "om_2", content: "发布窗口确认" }, [base], {
    ...task, taskAction: "updated", materialChangeSummary: "进入发布窗口",
  });
  assert.equal(h.state.state.shadowMatters.length, 1);
  assert.equal(h.state.state.shadowMatters[0].sources.length, 2);
  assert.equal(h.state.state.shadowDecisions.length, 2);
  assert.equal("content" in h.state.state.shadowMatters[0].sources[0], false);
});

test("compacts shadow decisions and sources as one lineage boundary", () => {
  const root = {
    shadowMatters: [{
      key: "matter-1",
      sources: [{ messageId: "kept" }],
    }],
    shadowDecisions: [
      { messageId: "orphan", matterKey: "matter-1" },
      { messageId: "kept", matterKey: "matter-1" },
      { messageId: "kept", matterKey: "missing-matter" },
    ],
  };
  compactShadowHistory(root);
  assert.deepEqual(root.shadowDecisions, [{ messageId: "kept", matterKey: "matter-1" }]);
  assert.deepEqual(root.shadowMatters[0].sources, [{ messageId: "kept" }]);
});

test("applies one global bound without orphaning matters or sources", () => {
  const root = {
    shadowMatters: Array.from({ length: 2001 }, (_, index) => ({
      key: `matter-${index}`,
      sources: [{ messageId: `message-${index}` }],
    })),
    shadowDecisions: Array.from({ length: 2001 }, (_, index) => ({
      messageId: `message-${index}`,
      matterKey: `matter-${index}`,
    })),
  };
  compactShadowHistory(root);
  assert.equal(root.shadowDecisions.length, 2000);
  assert.equal(root.shadowMatters.length, 2000);
  assert.equal(root.shadowDecisions[0].messageId, "message-1");
  assert.equal(root.shadowMatters[0].key, "matter-1");
});

test("retains every source referenced by the bounded shadow decision window", async () => {
  const h = harness();
  const monitor = new ShadowCollaborationMonitor(h);
  for (let index = 0; index < 25; index += 1) {
    await monitor.observe({
      message_id: `om_${index}`, chat_id: "oc_1", chat_name: "内部群", content: `同一事项 ${index}`,
      sender: { id: "ou_1" },
    }, [{ message_id: `om_${index}` }], {
      taskId: "task_1", taskAction: index === 0 ? "created" : "unchanged", title: "同一事项",
      priority: 1, notificationDecision: "silent", actionRequired: true,
      actionOwner: "changdongxu", nextAction: "继续跟进",
    });
  }
  const sources = new Set(h.state.state.shadowMatters.flatMap((matter) => matter.sources.map((source) => source.messageId)));
  assert.equal(h.state.state.shadowDecisions.length, 25);
  assert.equal(sources.size, 25);
  assert.ok(h.state.state.shadowDecisions.every((decision) => sources.has(decision.messageId)));
});

test("records ignored information silently", async () => {
  const h = harness();
  const monitor = new ShadowCollaborationMonitor(h);
  const decision = await monitor.observe({
    message_id: "om_info", chat_id: "oc_1", chat_name: "内部群", content: "资料分享",
    sender: { id: "ou_1" },
  }, [], {
    taskAction: "ignored", notificationDecision: "silent", priority: 0,
    intakeDecision: "information", actionRequired: false,
  });
  assert.equal(decision.attentionTier, "silent");
  assert.equal(h.state.state.shadowMatters[0].status, "observing");
});

test("detects completion, followup movement, and user-visible task edits", () => {
  const changes = detectTaskFeedback({
    projectId: "todo", status: 0, title: "旧标题", dueDate: null, priority: 1,
  }, {
    projectId: "followup", status: 2, title: "新标题", dueDate: "2026-09-01", priority: 0,
  }, { didaProjectId: "todo", followupProjectId: "followup" });
  assert.deepEqual(changes, ["completed", "moved_to_followup", "title_changed", "deadline_changed", "priority_changed"]);
});

test("writes and sends exactly one report after the shadow window", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shadow-report-"));
  const h = harness({ varDir: dir, shadowNotifyOnComplete: true });
  let sends = 0;
  h.lark.send = async () => { sends += 1; };
  const monitor = new ShadowCollaborationMonitor(h);
  monitor.ensureState(new Date("2026-08-01T00:00:00Z"));
  h.state.state.shadowMode.endsAt = "2026-08-02T00:00:00Z";
  h.state.state.shadowDecisions.push({ attentionTier: "silent", difference: "aligned" });
  await monitor.poll(new Date("2026-08-08T00:00:00Z"));
  await monitor.poll(new Date("2026-08-08T01:00:00Z"));
  assert.equal(sends, 1);
  assert.match(await readFile(h.state.state.shadowReport.path, "utf8"), /影子模式评估/);
  assert.ok(h.state.state.shadowReport.sentAt);
});

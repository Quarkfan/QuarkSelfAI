import test from "node:test";
import assert from "node:assert/strict";
import { DidaOverdueMonitor } from "../src/dida-overdue-monitor.js";

test("notifies an overdue task once per due-date and priority fingerprint", async () => {
  const state = { state: { overdueNotified: {}, overdueHealthFailure: null }, async save() {} };
  let sends = 0;
  const monitor = new DidaOverdueMonitor({
    state,
    lark: { async send() { sends += 1; } },
    taskCreator: { async listOverdue() { return { tasks: [{ taskId: "t1", title: "超期", dueDate: "2026-08-13", priority: 3, url: null }] }; } },
  });
  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  await monitor.poll(new Date("2026-08-28T02:01:00Z"));
  assert.equal(sends, 1);
});

test("normalizes equivalent due dates and migrates the stored fingerprint without notifying again", async () => {
  const state = {
    state: { overdueNotified: { t1: "2026-08-24T16:00:00+0000:3" }, overdueHealthFailure: null },
    saves: 0,
    async save() { this.saves += 1; },
  };
  let sends = 0;
  const monitor = new DidaOverdueMonitor({
    state,
    lark: { async send() { sends += 1; } },
    taskCreator: { async listOverdue() {
      return { tasks: [{ taskId: "t1", title: "超期", dueDate: "2026-08-24T16:00:00.000Z", priority: 3 }] };
    } },
  });

  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  assert.equal(sends, 0);
  assert.equal(state.state.overdueNotified.t1, "2026-08-24T16:00:00.000Z:3");
  assert.equal(state.saves, 1);
});

test("builds the overdue link from trusted configuration instead of model output", async () => {
  const state = { state: { overdueNotified: {}, overdueHealthFailure: null }, async save() {} };
  const messages = [];
  const monitor = new DidaOverdueMonitor({
    config: { didaProjectId: "project-1", notificationTimeZone: "Asia/Shanghai" },
    state,
    lark: { async send(message) { messages.push(message); } },
    taskCreator: { async listOverdue() {
      return { tasks: [{ taskId: "task-1", title: "超期", dueDate: "2026-08-24T16:00:00Z", priority: 3, url: "https://didadao.com/task/task-1" }] };
    } },
  });

  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  assert.match(messages[0], /2026-08-25 00:00:00/);
  assert.match(messages[0], /https:\/\/dida365\.com\/webapp\/#p\/project-1\/tasks\/task-1/);
  assert.doesNotMatch(messages[0], /didadao/);
});

test("debounces transient failures, retries, and only reports a notified recovery", async () => {
  const state = { state: { overdueNotified: {}, overdueHealthFailure: null }, async save() {} };
  const messages = [];
  let shouldFail = true;
  const monitor = new DidaOverdueMonitor({
    config: { overdueFailureNotifyThreshold: 3, overdueRetryIntervalMs: 60_000 },
    state,
    lark: { async send(message) { messages.push(message); } },
    taskCreator: {
      async listOverdue() {
        if (shouldFail) throw new Error("request timed out");
        return { tasks: [] };
      },
    },
    logger: { error() {} },
  });

  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  await monitor.poll(new Date("2026-08-28T02:01:00Z"));
  assert.equal(messages.length, 0);
  await monitor.poll(new Date("2026-08-28T02:02:00Z"));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /连续 3 次失败/);

  shouldFail = false;
  await monitor.poll(new Date("2026-08-28T02:03:00Z"));
  assert.equal(messages.length, 2);
  assert.match(messages[1], /已恢复/);
  assert.equal(state.state.overdueHealthFailure, null);
});

test("defers overdue reminders outside working hours and consolidates them later", async () => {
  const state = { state: { overdueNotified: {}, overdueLastNotifiedAt: {}, overdueHealthFailure: null }, async save() {} };
  const messages = [];
  const monitor = new DidaOverdueMonitor({
    config: { didaProjectId: "project-1", notificationTimeZone: "Asia/Shanghai" }, state,
    lark: { async send(message) { messages.push(message); } },
    taskCreator: { async listOverdue() { return { tasks: [
      { taskId: "t1", title: "事项一", dueDate: "2026-08-27T00:00:00Z", priority: 1 },
      { taskId: "t2", title: "事项二", dueDate: "2026-08-27T01:00:00Z", priority: 3 },
    ] }; } },
  });
  await monitor.poll(new Date("2026-08-27T20:00:00Z"));
  assert.equal(messages.length, 0);
  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /超期汇总/);
  assert.match(messages[0], /事项一/);
  assert.match(messages[0], /事项二/);
});

test("treats same-local-day due time drift as the same overdue reminder", async () => {
  const state = { state: { overdueNotified: { t1: "2026-08-25T00:00:00.000Z:1" }, overdueHealthFailure: null }, async save() {} };
  let sends = 0;
  const monitor = new DidaOverdueMonitor({
    config: { notificationTimeZone: "Asia/Shanghai" }, state,
    lark: { async send() { sends += 1; } },
    taskCreator: { async listOverdue() { return { tasks: [
      { taskId: "t1", title: "事项", dueDate: "2026-08-25T10:00:00.000Z", priority: 1 },
    ] }; } },
  });
  await monitor.poll(new Date("2026-08-28T02:00:00Z"));
  assert.equal(sends, 0);
});

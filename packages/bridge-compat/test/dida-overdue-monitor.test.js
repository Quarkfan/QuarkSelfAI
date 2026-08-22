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
  await monitor.poll();
  await monitor.poll();
  assert.equal(sends, 1);
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

  await monitor.poll();
  await monitor.poll();
  assert.equal(messages.length, 0);
  await monitor.poll();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /连续 3 次失败/);

  shouldFail = false;
  await monitor.poll();
  assert.equal(messages.length, 2);
  assert.match(messages[1], /已恢复/);
  assert.equal(state.state.overdueHealthFailure, null);
});

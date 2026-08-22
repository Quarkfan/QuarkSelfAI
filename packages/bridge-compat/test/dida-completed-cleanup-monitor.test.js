import test from "node:test";
import assert from "node:assert/strict";
import { DidaCompletedCleanupMonitor, didaCompletedCleanupSlot } from "../src/dida-completed-cleanup-monitor.js";

function harness(result = { deleted: [], skipped: [] }) {
  const sends = [];
  const state = {
    state: {
      didaCompletedCleanupLastDay: null,
      didaCompletedCleanupLastAt: null,
      didaCompletedCleanupHealthFailure: null,
    },
    async save() {},
  };
  let calls = 0;
  const monitor = new DidaCompletedCleanupMonitor({
    config: { didaCompletedCleanupHour: 3, didaCompletedCleanupTimeZone: "Asia/Shanghai" },
    state,
    lark: { async send(message) { sends.push(message); } },
    taskCreator: { async cleanupCompletedTasks() { calls += 1; return result; } },
  });
  return { monitor, state, sends, calls: () => calls };
}

test("runs completed-task cleanup once per local day and reports actual deletions", async () => {
  const h = harness({
    deleted: [{ taskId: "task-1", title: "【关注】旧任务", completedAt: "2026-06-01T00:00:00Z" }],
    skipped: [],
  });
  const now = new Date("2026-08-20T04:00:00Z");
  await h.monitor.poll(now);
  await h.monitor.poll(now);
  assert.equal(h.calls(), 1);
  assert.equal(h.state.state.didaCompletedCleanupLastDay, "2026-08-20");
  assert.match(h.sends[0], /已清理自动化待办中 1 条/);
});

test("does not run before the configured local hour", async () => {
  assert.equal(didaCompletedCleanupSlot(new Date("2026-08-19T18:00:00Z"), "Asia/Shanghai", 3).due, false);
});

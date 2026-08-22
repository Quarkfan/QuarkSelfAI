import test from "node:test";
import assert from "node:assert/strict";
import { WorkdayFollowupMonitor, workdaySlot } from "../src/weekly-followup-monitor.js";

test("workday slot becomes due at 10:00 Shanghai time and skips weekends", () => {
  assert.deepEqual(workdaySlot(new Date("2026-08-17T01:59:00Z")), { dayKey: "2026-08-17", due: false });
  assert.deepEqual(workdaySlot(new Date("2026-08-17T02:00:00Z")), { dayKey: "2026-08-17", due: true });
  assert.deepEqual(workdaySlot(new Date("2026-08-20T04:00:00Z")), { dayKey: "2026-08-20", due: true });
  assert.deepEqual(workdaySlot(new Date("2026-08-22T04:00:00Z")), { dayKey: "2026-08-22", due: false });
});

test("workday monitor stays quiet when no task needs follow-up", async () => {
  const messages = [];
  const state = { state: {}, async save() {} };
  const monitor = new WorkdayFollowupMonitor({
    config: { followupTimeZone: "Asia/Shanghai", followupScheduledHour: 10 },
    state,
    lark: { async send(message) { messages.push(message); } },
    taskCreator: { async evaluateWorkdayFollowups() { return { totalActive: 2, reminders: [] }; } },
  });
  await monitor.poll(new Date("2026-08-17T02:00:00Z"));
  assert.deepEqual(messages, []);
  assert.equal(state.state.followupLastCheckedDay, "2026-08-17");
});

test("workday monitor sends at most one evaluated reminder per day", async () => {
  const messages = [];
  const state = { state: {}, async save() {} };
  const monitor = new WorkdayFollowupMonitor({
    config: { followupTimeZone: "Asia/Shanghai", followupScheduledHour: 10 },
    state,
    lark: { async send(message, key) { messages.push({ message, key }); } },
    taskCreator: { async evaluateWorkdayFollowups() {
      return { totalActive: 3, reminders: [{ title: "确认处理进度", reason: "约定时间已过", recommendedAction: "联系负责人", urgency: "medium", url: "https://example.test/task" }] };
    } },
  });
  await monitor.poll(new Date("2026-08-17T02:00:00Z"));
  await monitor.poll(new Date("2026-08-17T05:00:00Z"));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].key, "workday-followup:2026-08-17");
  assert.match(messages[0].message, /约定时间已过/);
});

test("workday monitor checks again on the next weekday", async () => {
  let checks = 0;
  const state = { state: {}, async save() {} };
  const monitor = new WorkdayFollowupMonitor({
    config: { followupTimeZone: "Asia/Shanghai", followupScheduledHour: 10 },
    state,
    lark: { async send() {} },
    taskCreator: { async evaluateWorkdayFollowups() { checks += 1; return { totalActive: 0, reminders: [] }; } },
  });
  await monitor.poll(new Date("2026-08-17T02:00:00Z"));
  await monitor.poll(new Date("2026-08-18T02:00:00Z"));
  assert.equal(checks, 2);
  assert.equal(state.state.followupLastCheckedDay, "2026-08-18");
});

test("asks for approval before messaging a resolved follow-up contact", async () => {
  const cards = [];
  const outbound = [];
  const state = { state: {}, async save() {} };
  const monitor = new WorkdayFollowupMonitor({
    config: { followupTimeZone: "Asia/Shanghai", followupScheduledHour: 10 },
    state,
    lark: {
      async searchUsers() {
        return [{ open_id: "ou_owner", localized_name: "张三", department: "研发", is_cross_tenant: false }];
      },
      async sendInteractive(message, actions) { cards.push({ message, actions }); return { message_id: "approval-1" }; },
      async sendAsUser(userId, message) { outbound.push({ userId, message }); return { message_id: "sent-1", chat_id: "chat-1" }; },
      async updateCard() {},
      async send() {},
    },
    taskCreator: { async evaluateWorkdayFollowups() {
      return {
        totalActive: 1, updates: [], reminders: [],
        outreachRequests: [{
          taskId: "task-1", title: "确认进度", personName: "张三", personOpenId: "",
          question: "当前进展和预计完成时间是什么？", reason: "约定时间已到", context: "项目跟进", url: "",
        }],
      };
    } },
  });
  await monitor.poll(new Date("2026-08-17T02:00:00Z"));
  const request = state.state.followupOutreachRequests[0];
  assert.equal(request.status, "pending_approval");
  assert.match(cards[0].message, /发送身份/);
  assert.equal(outbound.length, 0);
  await monitor.handleCardAction({ token: "token", action_tag: "button" }, {
    type: "followup_outreach_decision", requestId: request.id, decision: "approve",
  });
  assert.equal(outbound[0].userId, "ou_owner");
  assert.match(outbound[0].message, /我是常东旭的 AI 分身/);
  assert.equal(request.status, "waiting_reply");
});

test("writes a contact reply back to the delegated task and reports it", async () => {
  const reports = [];
  const state = {
    state: {
      followupOutreachRequests: [{
        id: "req-1", status: "waiting_reply", taskId: "task-1", title: "确认进度",
        question: "进展如何？", personName: "张三", sentAt: "2026-08-17T02:00:00Z",
        sentMessageId: "sent-1", chatId: "chat-1", contact: { openId: "ou_owner", name: "张三" },
      }],
    },
    async save() {},
  };
  const monitor = new WorkdayFollowupMonitor({
    config: { followupTimeZone: "Asia/Shanghai", followupScheduledHour: 10 },
    state,
    lark: {
      async getChatMessagesSince() {
        return [{ message_id: "answer-1", content: "今天已经完成", sender: { id: "ou_owner" } }];
      },
      async send(message) { reports.push(message); },
    },
    taskCreator: {
      async recordFollowupReply() {
        return { taskId: "task-1", title: "确认进度", changes: ["追加回复记录"], summary: "已完成", url: "" };
      },
    },
  });
  await monitor.poll(new Date("2026-08-22T04:00:00Z"));
  assert.equal(state.state.followupOutreachRequests[0].status, "completed");
  assert.match(reports[0], /已写回滴答任务/);
});

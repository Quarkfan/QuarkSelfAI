import test from "node:test";
import assert from "node:assert/strict";
import { XiaoweiResearchChannel } from "../src/xiaowei-research-channel.js";

function harness() {
  const sentToAgent = [];
  const sentToUser = [];
  const state = {
    state: { xiaoweiResearchRequests: [], xiaoweiProcessedMessageIds: [], xiaoweiLastPollAt: null },
    async save() {},
  };
  const lark = {
    async sendAsUser(userId, message, approval) {
      sentToAgent.push({ userId, message, approval });
      return { message_id: "om_request", chat_id: "oc_xiaowei" };
    },
    async send(message) { sentToUser.push(message); },
    async getChatMessagesSince() { return []; },
  };
  const channel = new XiaoweiResearchChannel({
    config: {
      allowedOpenId: "ou_me",
      xiaoweiAgent: { name: "智造湖小维", openId: "ou_xiaowei", chatId: "oc_xiaowei" },
      xiaoweiInitialLookbackMinutes: 180,
    },
    state, lark,
  });
  return { channel, state, lark, sentToAgent, sentToUser };
}

test("sends a read-only BlackLake research request once and waits persistently", async () => {
  const h = harness();
  const task = { taskId: "task_1", title: "【重要】排查生产超时", researchPrompt: "核对生产日志和 Trace" };
  const message = { message_id: "om_source", chat_name: "内部群", sender: { name: "同事" } };
  const approval = { approvalId: "research:task_1", approvedAt: "2026-08-16T08:00:00Z" };
  const first = await h.channel.request(task, message, approval);
  const second = await h.channel.request(task, message, approval);
  assert.equal(first.id, second.id);
  assert.equal(h.sentToAgent.length, 1);
  assert.equal(first.status, "waiting_reply");
  assert.match(h.sentToAgent[0].message, /只读排查/);
  assert.deepEqual(h.sentToAgent[0].approval, approval);
});

test("correlates a slow reply, notifies the user, and keeps it out of normal intake", async () => {
  const h = harness();
  const request = await h.channel.request(
    { taskId: "task_1", title: "排查问题", researchPrompt: "查日志" },
    { message_id: "om_source", chat_name: "内部群", sender: { name: "同事" } },
    { approvalId: "research:task_1", approvedAt: "2026-08-16T08:00:00Z" },
  );
  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_answer", chat_id: "oc_xiaowei", reply_to: "om_request",
    content: "已确认 First Bad Hop", sender: { id: "ou_xiaowei", name: "智造湖小维" },
    create_time: "2026-08-16 16:00",
  }];
  await h.channel.poll(new Date("2026-08-16T08:01:00Z"));
  assert.equal(request.status, "reply_received");
  assert.equal(request.replyMessageId, "om_answer");
  assert.equal(h.sentToUser.length, 1);
  assert.match(h.sentToUser[0], /First Bad Hop/);
});

test("does not mirror replies from the owner's manual Xiaowei conversation", async () => {
  const h = harness();
  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_manual", chat_id: "oc_xiaowei", content: "现在创建",
    sender: { id: "ou_me", name: "常东旭" }, create_time: "2026-08-28 09:00",
  }, {
    message_id: "om_manual_answer", chat_id: "oc_xiaowei", reply_to: "om_manual", content: "已经创建完成",
    sender: { id: "ou_xiaowei", name: "智造湖小维" }, create_time: "2026-08-28 09:05",
  }];
  await h.channel.poll(new Date("2026-08-28T01:06:00Z"));
  assert.equal(h.sentToUser.length, 0);
  assert.equal(h.state.state.xiaoweiResearchRequests[0].status, "completed");
  assert.ok(h.state.state.xiaoweiProcessedMessageIds.includes("om_manual_answer"));
});

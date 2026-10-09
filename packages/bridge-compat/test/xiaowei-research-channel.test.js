import test from "node:test";
import assert from "node:assert/strict";
import { XiaoweiResearchChannel } from "../src/xiaowei-research-channel.js";

function harness() {
  const sentToAgent = [];
  const sentToUser = [];
  const errors = [];
  const infos = [];
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
    state, lark, logger: {
      error(...args) { errors.push(args); },
      info(...args) { infos.push(args); },
    },
  });
  return { channel, state, lark, sentToAgent, sentToUser, errors, infos };
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
    content: "调研结论：已确认 First Bad Hop", sender: { id: "ou_xiaowei", name: "智造湖小维" },
    create_time: "2026-08-16 16:00",
  }];
  await h.channel.poll(new Date("2026-08-16T08:01:00Z"));
  assert.equal(request.status, "reply_received");
  assert.equal(request.replyMessageId, "om_answer");
  assert.equal(h.sentToUser.length, 1);
  assert.match(h.sentToUser[0], /First Bad Hop/);
});

test("keeps progress replies pending and notifies only after the final result", async () => {
  const h = harness();
  const request = await h.channel.request(
    { taskId: "task_1", title: "排查问题", researchPrompt: "查日志" },
    { message_id: "om_source", chat_name: "内部群", sender: { name: "同事" } },
    { approvalId: "research:task_1", approvedAt: "2026-08-16T08:00:00Z" },
  );
  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_progress", chat_id: "oc_xiaowei", reply_to: "om_request",
    content: "已收到，正在处理中。", sender: { id: "ou_xiaowei", name: "智造湖小维" },
    create_time: "2026-08-16 16:00", msg_type: "text",
  }];
  await h.channel.poll(new Date("2026-08-16T08:01:00Z"));
  assert.equal(request.status, "progress_received");
  assert.equal(request.replyMessageId, undefined);
  assert.equal(h.sentToUser.length, 0);

  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_final", chat_id: "oc_xiaowei", reply_to: "om_request",
    content: `经核验形成最终结论。${"已验证证据。".repeat(20)}`,
    sender: { id: "ou_xiaowei", name: "智造湖小维" },
    create_time: "2026-08-16 16:10", msg_type: "post",
  }];
  await h.channel.poll(new Date("2026-08-16T08:11:00Z"));
  assert.equal(request.status, "reply_received");
  assert.equal(request.replyMessageId, "om_final");
  assert.equal(h.sentToUser.length, 1);
  assert.doesNotMatch(h.sentToUser[0], /正在处理中/);
  assert.match(h.sentToUser[0], /最终结论/);
});

test("does not mirror replies from the owner's manual Xiaowei conversation", async () => {
  const h = harness();
  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_manual", chat_id: "oc_xiaowei", content: "现在创建",
    sender: { id: "ou_me", name: "常东旭" }, create_time: "2026-08-28 09:00",
  }, {
    message_id: "om_manual_answer", chat_id: "oc_xiaowei", reply_to: "om_manual", content: "调研结果：已经创建完成",
    sender: { id: "ou_xiaowei", name: "智造湖小维" }, create_time: "2026-08-28 09:05",
  }];
  await h.channel.poll(new Date("2026-08-28T01:06:00Z"));
  assert.equal(h.sentToUser.length, 0);
  assert.equal(h.state.state.xiaoweiResearchRequests[0].status, "completed");
  assert.ok(h.state.state.xiaoweiProcessedMessageIds.includes("om_manual_answer"));
});

test("does not persist the message ID of an unmatched Xiaowei update in logs", async () => {
  const h = harness();
  h.lark.getChatMessagesSince = async () => [{
    message_id: "om_unmatched_secret", chat_id: "oc_xiaowei", content: "后台状态更新",
    sender: { id: "ou_xiaowei", name: "智造湖小维" }, create_time: "2026-10-09 14:00",
  }];

  await h.channel.poll(new Date("2026-10-09T06:01:00Z"));

  assert.deepEqual(h.infos, [["ignored unmatched Xiaowei update already visible in the owner's direct chat"]]);
  assert.doesNotMatch(JSON.stringify(h.infos), /om_unmatched_secret/);
  assert.ok(h.state.state.xiaoweiProcessedMessageIds.includes("om_unmatched_secret"));
});

test("redacts source failure details from Xiaowei logs, state, and owner alerts", async () => {
  const h = harness();
  h.channel.config.xiaoweiFailureNotifyAfterMs = 0;
  h.lark.getChatMessagesSince = async () => {
    throw new Error(`飞书追问回复读取失败: {
      "error":{"type":"authentication","subtype":"token_missing","message":"need authorization for ou_secret at https://open.feishu.cn from 172.16.41.126"}
    }`);
  };
  const startedAt = new Date("2026-10-08T04:00:00Z");
  await h.channel.poll(startedAt);
  await h.channel.poll(new Date(startedAt.getTime() + 1));
  await h.channel.poll(new Date(startedAt.getTime() + 2));

  assert.deepEqual(h.errors[0], ["xiaowei research poll failed", {
    category: "authentication", subtype: "token_missing",
  }]);
  assert.match(h.state.state.xiaoweiHealthFailure.error, /authentication\/token_missing/);
  assert.equal(h.sentToUser.length, 1);
  const publicEvidence = JSON.stringify({ errors: h.errors, failure: h.state.state.xiaoweiHealthFailure, sent: h.sentToUser });
  assert.doesNotMatch(publicEvidence, /ou_secret|172\.16\.41\.126|open\.feishu\.cn|need authorization/);
});

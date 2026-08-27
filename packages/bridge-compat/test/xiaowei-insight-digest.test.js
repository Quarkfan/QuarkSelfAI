import test from "node:test";
import assert from "node:assert/strict";
import { buildInsightCandidates, XiaoweiInsightDigestMonitor } from "../src/xiaowei-insight-digest.js";

function action(id, original, result = "", taskId = "task-example") {
  return {
    message_id: id,
    create_time: "2026-08-27 12:00",
    message_app_link: `https://example.test/${id}`,
    content: `<card>\n**来源**：某内部群 / 某同事\n\n**原消息**：${original}\n\n**任务**：${taskId} 调查问题\n\n**执行内容**：${result}\n[详情](https://example.test/action)\n</card>`,
  };
}

test("collapses repeated action records into one insight candidate", () => {
  const messages = [
    action("om_start", "为什么复杂 Skill 会超时，简单查询却不会？", "", "task-timeout"),
    action("om_done", "为什么复杂 Skill 会超时，简单查询却不会？", "已定位：HTTP 客户端等待响应头达到固定上限。", "task-timeout"),
  ];
  const candidates = buildInsightCandidates(messages);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].result, /固定上限/);
  assert.equal(candidates[0].link, "https://example.test/om_done");
});

test("sends one Friday digest and advances the durable window", async () => {
  const sent = [];
  const state = { state: {}, async save() {} };
  const monitor = new XiaoweiInsightDigestMonitor({
    config: {
      xiaoweiInsightDigestEnabled: true,
      xiaoweiInsightDigestChatId: "oc_monitor",
      xiaoweiInsightDigestTimeZone: "Asia/Shanghai",
      xiaoweiInsightDigestWeekday: 5,
      xiaoweiInsightDigestHour: 17,
      xiaoweiInsightDigestMinute: 30,
      xiaoweiInsightDigestLookbackDays: 7,
      xiaoweiInsightDigestMaxItems: 6,
    },
    state,
    lark: {
      async getChatMessagesRange() {
        return [action("om_1", "为什么分页会同时出现重复和漏数？", "根因是排序字段不唯一，分页边界不稳定。", "task-page")];
      },
      async send(body, key) { sent.push({ body, key }); },
    },
    async summarizer() { return { body: "## 小维对话洞察周报\n\n一条洞察", provider: "claude" }; },
  });
  const now = new Date("2026-08-28T10:00:00.000Z");
  await monitor.poll(now);
  await monitor.poll(now);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "xiaowei-insight-digest:2026-08-28");
  assert.equal(state.state.xiaoweiInsightDigest.lastSentDay, "2026-08-28");
  assert.equal(state.state.xiaoweiInsightDigest.reports[0].provider, "claude");
});

test("does not send an empty weekly card", async () => {
  const sent = [];
  const state = { state: {}, async save() {} };
  const monitor = new XiaoweiInsightDigestMonitor({
    config: { xiaoweiInsightDigestChatId: "oc_monitor", xiaoweiInsightDigestWeekday: 5,
      xiaoweiInsightDigestHour: 17, xiaoweiInsightDigestMinute: 30 },
    state,
    lark: { async getChatMessagesRange() { return []; }, async send(body) { sent.push(body); } },
    async summarizer() { throw new Error("should not run"); },
  });
  await monitor.poll(new Date("2026-08-28T10:00:00.000Z"));
  assert.equal(sent.length, 0);
  assert.equal(state.state.xiaoweiInsightDigest.reports[0].sent, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPriorityMessageFilter, LarkClient } from "../src/lark-client.js";

test("uses one event filter for owner DMs and explicit group mentions", () => {
  const filter = buildPriorityMessageFilter("ou_me");
  assert.match(filter, /chat_type=="p2p"/);
  assert.match(filter, /sender_id=="ou_me"/);
  assert.match(filter, /chat_type=="group"/);
  assert.match(filter, /mentions/);
  assert.match(filter, /any\(\.id=="ou_me"\)/);
});

test("reads agenda arrays from the lark-cli success envelope", async () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  client.run = async () => ({
    code: 0,
    stderr: "",
    stdout: '{"ok":true,"identity":"user","data":[{"event_id":"event_1","summary":"发布窗口"}]}',
  });
  const events = await client.listAgenda("2026-08-20", "2026-08-28");
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, "event_1");
});

test("rejects a calendar API error even when the CLI process exits zero", async () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  client.run = async () => ({
    code: 0,
    stderr: "",
    stdout: '{"ok":false,"identity":"user","error":{"message":"too many request"}}',
  });
  await assert.rejects(() => client.listAgenda("2026-08-20", "2026-08-28"), /日程读取失败/);
});

test("reads both nearby context and the newest conversation tail for stale messages", async () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  const calls = [];
  client.run = async (args) => {
    calls.push(args);
    const descending = args.includes("desc");
    return {
      code: 0, stderr: "",
      stdout: JSON.stringify({ ok: true, data: { messages: descending
        ? [{ message_id: "latest", content: "常东旭已回复", sender: { id: "ou_me" } }]
        : [{ message_id: "target", content: "请处理", sender: { id: "ou_other" } }] } }),
    };
  };
  const messages = await client.getMentionContext({
    message_id: "target", chat_id: "oc_1", create_time: "2026-08-20 10:00",
  }, 30);
  assert.equal(calls.length, 2);
  assert.equal(messages.at(-1).message_id, "latest");
  assert.ok(calls[1].includes("desc"));
});

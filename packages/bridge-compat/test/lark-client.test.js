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

test("builds an exact membership listener filter for Ren inviting the owner", () => {
  const client = new LarkClient({
    larkCli: "lark-cli", allowedOpenId: "ou_me",
    delegationInviter: { openId: "ou_ren" },
  });
  let observed;
  client.listenToEvent = (eventKey, jq) => { observed = { eventKey, jq }; return "listener"; };
  assert.equal(client.listenMembershipAdded(() => {}), "listener");
  assert.equal(observed.eventKey, "im.chat.member.user.added_v1");
  assert.match(observed.jq, /operator_id\.open_id=="ou_ren"/);
  assert.match(observed.jq, /user_id\.open_id=="ou_me"/);
});

test("delegated group searches remain active when flagged-conversation monitoring is disabled", async () => {
  const client = new LarkClient({ larkCli: "lark-cli", monitorFlaggedConversations: false });
  const labels = [];
  client.searchMessages = async (_filters, label) => { labels.push(label); return [{ message_id: "om_1" }]; };
  assert.deepEqual(await client.searchFlaggedConversationMessages("start", "end", ["oc_1"]), []);
  assert.equal((await client.searchDelegatedGroupMessages("start", "end", ["oc_1"])).length, 1);
  assert.deepEqual(labels, ["任永强交接群消息搜索"]);
});

test("reads a complete user group list and rejects incomplete pagination", async () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  client.run = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { chats: [{ chat_id: "oc_1" }], has_more: false }, meta: { pagination: { complete: true } } }) });
  assert.deepEqual(await client.listGroupChats(), [{ chat_id: "oc_1" }]);
  client.run = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { chats: [], has_more: true } }) });
  await assert.rejects(() => client.listGroupChats(), /分页未完成/);
});

test("reaction listeners use separate native V2 event streams", () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  const calls = [];
  client.listenToEvent = (eventKey, jq) => { calls.push({ eventKey, jq }); return eventKey; };
  client.listenReactionCreated(() => {});
  client.listenReactionDeleted(() => {});
  assert.deepEqual(calls.map((item) => item.eventKey), [
    "im.message.reaction.created_v1", "im.message.reaction.deleted_v1",
  ]);
  assert.equal(calls.every((item) => item.jq.includes(".event.operator_type")), true);
});

test("owner engagement searches keep reaction enrichment while ordinary focus searches opt out", async () => {
  const client = new LarkClient({ larkCli: "lark-cli", allowedOpenId: "ou_me" });
  const calls = [];
  client.run = async (args) => {
    calls.push(args);
    return { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { messages: [] } }) };
  };
  await client.searchMentions("start", "end");
  await client.searchOwnerMessages("start", "end");
  assert.equal(calls[0].includes("--no-reactions"), true);
  assert.equal(calls[1].includes("--no-reactions"), false);
  assert.ok(calls[1].includes("ou_me"));
});

test("fetches a known reaction target by message id without extra enrichment", async () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  let args;
  client.run = async (value) => {
    args = value;
    return { code: 0, stderr: "", stdout: JSON.stringify({ ok: true, data: { messages: [{ message_id: "om_1", chat_id: "oc_1" }] } }) };
  };
  assert.equal((await client.getMessagesByIds(["om_1"]))[0].chat_id, "oc_1");
  assert.equal(args.includes("--no-reactions"), true);
});

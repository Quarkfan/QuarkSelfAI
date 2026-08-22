import test from "node:test";
import assert from "node:assert/strict";
import { formatUserTime, parseCliJson } from "../src/util.js";

test("formats stored UTC timestamps for the user's notification timezone", () => {
  assert.equal(formatUserTime("2026-08-20T12:56:29.109Z", "Asia/Shanghai"), "2026-08-20 20:56:29");
  assert.equal(formatUserTime("not-a-date", "Asia/Shanghai"), "未知时间");
});
import { LarkClient } from "../src/lark-client.js";

test("parses JSON after a CLI version banner", () => {
  assert.deepEqual(parseCliJson('lark-cli v3.1.0\nupdate available\n{"ok":true,"data":{"messages":[]}}\n'), {
    ok: true, data: { messages: [] },
  });
});

test("ignores brace-like banner text before the real JSON envelope", () => {
  assert.deepEqual(parseCliJson('notice {not-json}\n{"ok":true}'), { ok: true });
});

test("disables CLI update and skills notifiers for daemon subprocesses", () => {
  const client = new LarkClient({ larkCli: "lark-cli" });
  assert.equal(client.environment.LARKSUITE_CLI_NO_UPDATE_NOTIFIER, "1");
  assert.equal(client.environment.LARKSUITE_CLI_NO_SKILLS_NOTIFIER, "1");
});

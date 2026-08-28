import test from "node:test";
import assert from "node:assert/strict";
import { formatUserTime, isExplicitCardActionConfigurationFailure, isWithinLocalHourWindow, parseCliJson, run } from "../src/util.js";

test("formats stored UTC timestamps for the user's notification timezone", () => {
  assert.equal(formatUserTime("2026-08-20T12:56:29.109Z", "Asia/Shanghai"), "2026-08-20 20:56:29");
  assert.equal(formatUserTime("not-a-date", "Asia/Shanghai"), "未知时间");
});

test("evaluates notification windows in the configured timezone", () => {
  assert.equal(isWithinLocalHourWindow("2026-08-28T01:00:00Z", "Asia/Shanghai", 9, 19), true);
  assert.equal(isWithinLocalHourWindow("2026-08-27T20:00:00Z", "Asia/Shanghai", 9, 19), false);
});

test("does not mistake transient token transport failures for missing card callback configuration", () => {
  assert.equal(isExplicitCardActionConfigurationFailure(
    'resolve tenant access token: Post "https://accounts.feishu.cn/oauth/v3/token": EOF',
  ), false);
  assert.equal(isExplicitCardActionConfigurationFailure(
    "card.action.trigger is not configured; enable the event subscription",
  ), true);
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

test("recognizes a deadline when a child translates SIGTERM into exit 143", async () => {
  const result = await run(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => process.exit(143)); setInterval(() => {}, 1000);",
  ], { timeoutMs: 200 });
  assert.equal(result.code, 143);
  assert.equal(result.timedOut, true);
});

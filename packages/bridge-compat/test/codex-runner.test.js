import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildConversationContinuityContext, buildUniqueSessionTitle, CodexRunner, SessionBusyError } from "../src/codex-runner.js";

test("builds bounded continuity guidance without replacing the current request", () => {
  const context = buildConversationContinuityContext({
    previousMessages: [{ messageId: "m1", content: "检查飞书断线", receivedAt: "2026-08-23T01:00:00Z" }],
    currentMessage: { messageId: "m2", replyTo: "m1" },
  });
  assert.match(context, /上下文连贯性/);
  assert.match(context, /检查飞书断线/);
  assert.match(context, /"replyTo":"m1"/);
  assert.match(context, /不要从含糊短句推断高影响操作的批准/);
});
import { runStructuredTurn } from "../src/codex-app-server-client.js";

async function fakeCodex(script) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-codex-"));
  const file = path.join(dir, "codex");
  await writeFile(file, `#!/bin/zsh\n${script}\n`, { mode: 0o755 });
  return { dir, file };
}

test("resumes a session and reads final response", async () => {
  const fake = await fakeCodex(`
out=""
has_skip="false"
while (( $# )); do
  if [[ "$1" == "-o" ]]; then shift; out="$1"; fi
  if [[ "$1" == "--skip-git-repo-check" ]]; then has_skip="true"; fi
  shift
done
if [[ "$has_skip" != "true" ]]; then print -u2 'missing --skip-git-repo-check'; exit 2; fi
read prompt
print '{"type":"turn.completed"}'
print -r -- "模拟完成：$prompt" > "$out"
`);
  const runner = new CodexRunner({
    codexCli: fake.file, workspaceRoot: fake.dir, varDir: path.join(fake.dir, "var"), progressIntervalMs: 0,
  });
  const result = await runner.execute({ sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", prompt: "检查测试" });
  assert.match(result, /模拟完成：检查测试/);
});

test("controller execution loads the local session tools and preserves the raw request", async () => {
  const fake = await fakeCodex(`
print -r -- "$@" > "$PWD/args.txt"
out=""
while (( $# )); do
  if [[ "$1" == "-o" ]]; then shift; out="$1"; fi
  shift
done
prompt="$(cat)"
print '{"type":"turn.completed"}'
print -r -- "$prompt" > "$out"
`);
  const runner = new CodexRunner({
    codexCli: fake.file, workspaceRoot: fake.dir, varDir: path.join(fake.dir, "var"), progressIntervalMs: 0,
    bridgeControlMcpEnabled: true,
  });
  const result = await runner.execute({
    sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", prompt: "对目标任务继续排查", controller: true,
  });
  const args = await readFile(path.join(fake.dir, "args.txt"), "utf8");
  assert.match(args, /mcp_servers\.codex_bridge\.command/);
  assert.match(args, /codex-bridge-mcp\.js/);
  assert.match(result, /^对目标任务继续排查/);
  assert.match(result, /不要先把要求归类成固定枚举/);
});

test("classifies writer lock errors as retryable busy", async () => {
  const fake = await fakeCodex(`print -u2 'thread writer lock is already held'; exit 1`);
  const runner = new CodexRunner({
    codexCli: fake.file, workspaceRoot: fake.dir, varDir: path.join(fake.dir, "var"), progressIntervalMs: 0,
  });
  await assert.rejects(
    runner.execute({ sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", prompt: "检查" }),
    SessionBusyError,
  );
});

test("moves a disconnected Codex session job to a resumable Claude Code fallback", async () => {
  const fake = await fakeCodex(`print -u2 'request timed out'; exit 1`);
  const claude = path.join(fake.dir, "claude");
  await writeFile(claude, `#!/bin/zsh
cat >/dev/null
print '{"type":"result","session_id":"dddddddd-dddd-dddd-dddd-dddddddddddd","result":"Claude 已继续处理"}'
`, { mode: 0o755 });
  const runner = new CodexRunner({
    codexCli: fake.file, claudeCli: claude, codexHome: fake.dir,
    workspaceRoot: fake.dir, varDir: path.join(fake.dir, "var"), progressIntervalMs: 0,
    claudeFallbackEnabled: true,
  });
  const job = { sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", prompt: "继续处理" };
  const result = await runner.execute(job);
  assert.match(result, /Claude 已继续处理/);
  assert.equal(job.executor, "claude");
  assert.match(job.claudeSessionId, /^[0-9a-f-]{36}$/);
});

test("creates a new session and captures its thread id", async () => {
  const fake = await fakeCodex(`
while IFS= read -r line; do
  print -r -- "$line" >> "$PWD/requests.ndjson"
  if [[ "$line" == *'"id":1'* ]]; then
    print '{"id":1,"result":{"codexHome":"/tmp"}}'
  elif [[ "$line" == *'"id":2'* ]]; then
    print '{"id":2,"result":{"thread":{"id":"cccccccc-cccc-cccc-cccc-cccccccccccc"}}}'
  elif [[ "$line" == *'"id":3'* ]]; then
    print '{"id":3,"result":{"turn":{"id":"turn-1"}}}'
    print '{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"新会话完成：调查问题"}}}'
    print '{"method":"turn/completed","params":{"threadId":"cccccccc-cccc-cccc-cccc-cccccccccccc","turn":{"status":"completed"}}}'
  fi
done
`);
  const runner = new CodexRunner({
    codexCli: fake.file, workspaceRoot: fake.dir, varDir: path.join(fake.dir, "var"), progressIntervalMs: 0,
    codexNewThreadModel: "gpt-5.6-sol", codexNewThreadEffort: "medium",
  });
  const result = await runner.create("调查问题", "message-1");
  assert.equal(result.sessionId, "cccccccc-cccc-cccc-cccc-cccccccccccc");
  assert.match(result.final, /新会话完成：调查问题/);
  const requests = (await readFile(path.join(fake.dir, "requests.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const threadStart = requests.find((request) => request.method === "thread/start");
  const turnStart = requests.find((request) => request.method === "turn/start");
  assert.equal(threadStart.params.model, "gpt-5.6-sol");
  assert.equal(turnStart.params.model, "gpt-5.6-sol");
  assert.equal(turnStart.params.effort, "medium");
  const titleRequest = requests.find((request) => request.method === "thread/name/set");
  assert.match(titleRequest.params.name, /^【AI创建·\d{8}-\d{6}-\d{3}·[0-9A-F]{6}】调查问题$/);
  assert.equal(result.title, titleRequest.params.name);
});

test("builds readable unique session titles within the sidebar limit", () => {
  const now = new Date("2026-08-21T03:20:30.456Z");
  const first = buildUniqueSessionTitle("自动调研：客户扫码性能问题", "mention:om_123", now);
  const second = buildUniqueSessionTitle("自动调研：客户扫码性能问题", "mention:om_456", now);
  assert.match(first, /^【AI创建·20260821-112030-456·[0-9A-F]{6}】自动调研：客户扫码性能问题$/);
  assert.notEqual(first, second);
  assert.ok(first.length <= 80);
  const long = buildUniqueSessionTitle("很长的标题".repeat(30), "message-long", now);
  assert.equal(long.length, 80);
});

test("runs an ephemeral read-only structured Codex worker turn", async () => {
  const fake = await fakeCodex(`
while IFS= read -r line; do
  print -r -- "$line" >> "$PWD/router-requests.ndjson"
  if [[ "$line" == *'"id":1'* ]]; then
    print '{"id":1,"result":{"codexHome":"/tmp"}}'
  elif [[ "$line" == *'"id":2'* ]]; then
    print '{"id":2,"result":{"thread":{"id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}}}'
  elif [[ "$line" == *'"id":3'* ]]; then
    print '{"id":3,"result":{"turn":{"id":"turn-route"}}}'
    print -r -- '{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"{\\"action\\":\\"status\\"}"}}}'
    print '{"method":"turn/completed","params":{"threadId":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","turn":{"status":"completed"}}}'
  fi
done
`);
  const schema = { type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string" } } };
  const result = await runStructuredTurn({ codexCli: fake.file, workspaceRoot: fake.dir }, "判断目的", schema, {
    model: "gpt-5.6-luna", effort: "low",
  });
  assert.deepEqual(result, { action: "status" });
  const requests = (await readFile(path.join(fake.dir, "router-requests.ndjson"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const threadStart = requests.find((request) => request.method === "thread/start");
  const turnStart = requests.find((request) => request.method === "turn/start");
  assert.equal(threadStart.params.ephemeral, true);
  assert.equal(turnStart.params.model, "gpt-5.6-luna");
  assert.equal(turnStart.params.effort, "low");
  assert.deepEqual(turnStart.params.outputSchema, schema);
  assert.equal(turnStart.params.sandboxPolicy.type, "readOnly");
});

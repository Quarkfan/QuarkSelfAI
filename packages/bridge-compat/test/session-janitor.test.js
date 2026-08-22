import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionJanitor } from "../src/session-janitor.js";

test("archives only automation sessions whose Dida task is completed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-janitor-"));
  const fake = path.join(dir, "codex");
  await writeFile(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const state = {
    state: {
      mentionClarifications: [{ researchSessionId: "waiting" }],
      mentionResearchSessions: [
        { sessionId: "done", taskId: "task_done", archivedAt: null },
        { sessionId: "waiting", taskId: "task_waiting", archivedAt: null },
        { sessionId: "open", taskId: "task_open", archivedAt: null },
      ],
    },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: fake, workspaceRoot: dir },
    state,
    lark: { async send() {} },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return ["task_done", "task_waiting"]; } },
    archiveStatus: async () => false,
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.ok(state.state.mentionResearchSessions[0].archivedAt);
  assert.equal(state.state.mentionResearchSessions[1].archivedAt, null);
  assert.equal(state.state.mentionResearchSessions[2].archivedAt, null);
});

test("silently reconciles a session already archived by the desktop app", async () => {
  const session = { sessionId: "already-done", taskId: "task_done", archivedAt: null };
  const messages = [];
  const state = {
    state: { mentionClarifications: [], mentionResearchSessions: [session] },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: "/does/not/exist", workspaceRoot: "/tmp" },
    state,
    lark: { async send(message) { messages.push(message); } },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return ["task_done"]; } },
    archiveStatus: async () => true,
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.equal(session.archivedAt, "2026-08-14T00:00:00.000Z");
  assert.deepEqual(messages, []);
});

test("backs off one failed session without blocking later sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-janitor-failure-"));
  const fake = path.join(dir, "codex");
  await writeFile(fake, "#!/bin/sh\nif [ \"$2\" = \"bad\" ]; then echo nope >&2; exit 1; fi\nexit 0\n", { mode: 0o755 });
  const bad = { sessionId: "bad", taskId: "task_bad", archivedAt: null };
  const good = { sessionId: "good", taskId: "task_good", archivedAt: null };
  const state = {
    state: { mentionClarifications: [], mentionResearchSessions: [bad, good] },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: fake, workspaceRoot: dir },
    state,
    lark: { async send() {} },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return ["task_bad", "task_good"]; } },
    archiveStatus: async () => false,
    logger: { error() {} },
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.equal(bad.archivedAt, null);
  assert.equal(bad.archiveFailureCount, 1);
  assert.equal(bad.archiveNextRetryAt, "2026-08-14T01:00:00.000Z");
  assert.equal(good.archivedAt, "2026-08-14T00:00:00.000Z");
});

test("permanently deletes only auto research sessions archived for seven days", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-janitor-delete-"));
  const log = path.join(dir, "calls.log");
  const fake = path.join(dir, "codex");
  await writeFile(fake, `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const expired = {
    sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", taskId: "task_old",
    archivedAt: "2026-08-06T23:59:59.000Z",
  };
  const recent = {
    sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", taskId: "task_recent",
    archivedAt: "2026-08-08T00:00:01.000Z",
  };
  const state = {
    state: { mentionClarifications: [], mentionResearchSessions: [expired, recent] },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: fake, workspaceRoot: dir, sessionDeleteAfterDays: 7 },
    state,
    lark: { async send() {} },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return []; } },
    archiveStatus: async () => false,
    sessionStatus: async () => ({ exists: true, archived: true }),
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.equal(expired.deletedAt, "2026-08-14T00:00:00.000Z");
  assert.equal(recent.deletedAt, undefined);
  assert.match(await readFile(log, "utf8"), /delete --force aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/);
});

test("does not delete an auto research session that was manually unarchived", async () => {
  const session = {
    sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", taskId: "task_old",
    archivedAt: "2026-08-01T00:00:00.000Z",
  };
  const state = {
    state: { mentionClarifications: [], mentionResearchSessions: [session] },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: "/does/not/exist", workspaceRoot: "/tmp", sessionDeleteAfterDays: 7 },
    state,
    lark: { async send() {} },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return []; } },
    archiveStatus: async () => false,
    sessionStatus: async () => ({ exists: true, archived: false }),
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.equal(session.deletedAt, undefined);
});

test("reconciles an already missing expired session as deleted", async () => {
  const session = {
    sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", taskId: "task_old",
    archivedAt: "2026-08-01T00:00:00.000Z",
  };
  const state = {
    state: { mentionClarifications: [], mentionResearchSessions: [session] },
    async save() {},
  };
  const janitor = new SessionJanitor({
    config: { codexCli: "/does/not/exist", workspaceRoot: "/tmp", sessionDeleteAfterDays: 7 },
    state,
    lark: { async send() {} },
    runner: { isRunning() { return false; } },
    taskCreator: { async getCompletedTaskIds() { return []; } },
    archiveStatus: async () => false,
    sessionStatus: async () => ({ exists: false, archived: false }),
  });
  await janitor.sweep(new Date("2026-08-14T00:00:00.000Z"));
  assert.equal(session.deletedAt, "2026-08-14T00:00:00.000Z");
});

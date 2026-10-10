import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state-store.js";

test("recovers the first complete state object and removes a corrupted tail", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bridge-state-"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "state.json"), '{"queue":[{"id":"kept"}]}\ncorrupted tail');
  const store = new StateStore(dir);
  await store.load();
  assert.equal(store.state.queue[0].id, "kept");
  const repaired = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
  assert.equal(repaired.queue[0].id, "kept");
});

test("serializes concurrent state saves", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bridge-state-save-"));
  const store = new StateStore(dir);
  await store.load();
  store.state.queue.push({ id: "one" });
  await Promise.all([store.save(), store.save(), store.save()]);
  const saved = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
  assert.equal(saved.queue[0].id, "one");
});

test("recovers an interrupted approved BlackLake execution for the same durable retry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bridge-state-execution-recovery-"));
  await writeFile(path.join(dir, "state.json"), JSON.stringify({
    mentionExecutionConfirmations: [{ approvalId: "approval-1", planDigest: "digest-1", status: "executing", nextAttemptAt: "2099-01-01T00:00:00.000Z" }],
  }));
  const store = new StateStore(dir);
  await store.load();
  assert.equal(store.state.mentionExecutionConfirmations[0].status, "approved");
  assert.equal(store.state.mentionExecutionConfirmations[0].nextAttemptAt, null);
  const saved = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
  assert.equal(saved.mentionExecutionConfirmations[0].status, "approved");
});

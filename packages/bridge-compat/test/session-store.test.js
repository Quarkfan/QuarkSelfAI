import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../src/session-store.js";

test("finds sessions by exact UUID and fuzzy title with latest title wins", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-lark-sessions-"));
  await mkdir(path.join(home, "thread-writer-locks"));
  await writeFile(path.join(home, "session_index.jsonl"), [
    JSON.stringify({ id: "019ffa0a-1ac8-7263-90c6-27a7c25eb60f", thread_name: "旧标题", updated_at: "2026-08-13T01:00:00Z" }),
    JSON.stringify({ id: "019ffa0a-1ac8-7263-90c6-27a7c25eb60f", thread_name: "HHZZ3-104566 自定义对象", updated_at: "2026-08-13T02:00:00Z" }),
    JSON.stringify({ id: "019ffa0d-b929-7c52-9e05-929712e82f3a", thread_name: "另一个会话", updated_at: "2026-08-13T03:00:00Z" }),
  ].join("\n"));
  const store = new SessionStore(home);
  assert.equal((await store.find("HHZZ3-104566"))[0].title, "HHZZ3-104566 自定义对象");
  assert.equal((await store.find("019ffa0a-1ac8-7263-90c6-27a7c25eb60f"))[0].id, "019ffa0a-1ac8-7263-90c6-27a7c25eb60f");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCodexWithClaudeFallback } from "../src/cli-failover.js";

test("falls back to Claude Code for a Codex infrastructure failure and preserves structured output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-failover-"));
  const codex = path.join(dir, "codex");
  const claude = path.join(dir, "claude");
  const schemaPath = path.join(dir, "schema.json");
  const outputPath = path.join(dir, "output.json");
  await writeFile(codex, "#!/bin/zsh\nprint -u2 '401 Unauthorized: Incorrect API key'; exit 1\n", { mode: 0o755 });
  await writeFile(claude, `#!/bin/zsh
while (( $# )); do shift; done
cat >/dev/null
print '{"type":"result","session_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","structured_output":{"ok":true}}'
`, { mode: 0o755 });
  await writeFile(schemaPath, JSON.stringify({
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  }));

  const result = await runCodexWithClaudeFallback({
    codexCli: codex, claudeCli: claude, claudeFallbackEnabled: true,
  }, ["exec", "--output-schema", schemaPath, "-o", outputPath, "-"], { cwd: dir, input: "检查" });

  assert.equal(result.code, 0);
  assert.equal(result.provider, "claude");
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), { ok: true });
});

test("does not fall back for a deterministic Codex schema error", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-no-failover-"));
  const codex = path.join(dir, "codex");
  await writeFile(codex, "#!/bin/zsh\nprint -u2 'Invalid schema for response_format'; exit 1\n", { mode: 0o755 });
  const result = await runCodexWithClaudeFallback({
    codexCli: codex, claudeCli: "/does/not/run", claudeFallbackEnabled: true,
  }, ["exec"], { cwd: dir, input: "检查" });
  assert.equal(result.code, 1);
  assert.equal(result.provider, "codex");
  assert.equal(result.fallbackAttempted, undefined);
});

test("shares the protected dida CLI token with Codex and Claude without putting it in arguments", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-dida-token-"));
  const codex = path.join(dir, "codex");
  const claude = path.join(dir, "claude");
  const didaConfig = path.join(dir, "dida-config.json");
  const schemaPath = path.join(dir, "schema.json");
  const outputPath = path.join(dir, "output.json");
  const token = "shared-dida-token-for-test";
  await writeFile(didaConfig, JSON.stringify({ access_token: token }), { mode: 0o600 });
  await writeFile(codex, [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    `if (process.env.DIDA_TEST_TOKEN !== ${JSON.stringify(token)}) process.exit(7);`,
    "if (!args.includes('mcp_servers.dida365.bearer_token_env_var=\"DIDA_TEST_TOKEN\"')) process.exit(8);",
    "console.error('401 Unauthorized');",
    "process.exit(1);",
  ].join("\n"), { mode: 0o755 });
  await writeFile(claude, [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2).join(' ');",
    `if (process.env.DIDA_TEST_TOKEN !== ${JSON.stringify(token)}) process.exit(9);`,
    "if (!args.includes('Bearer ${DIDA_TEST_TOKEN}')) process.exit(10);",
    `if (args.includes(${JSON.stringify(token)})) process.exit(11);`,
    "process.stdin.resume();",
    "process.stdin.on('end', () => console.log(JSON.stringify({type:'result',structured_output:{ok:true}})));",
  ].join("\n"), { mode: 0o755 });
  await writeFile(schemaPath, JSON.stringify({
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  }));

  const result = await runCodexWithClaudeFallback({
    codexCli: codex,
    claudeCli: claude,
    claudeFallbackEnabled: true,
    didaCliConfigPath: didaConfig,
    didaTokenEnvVar: "DIDA_TEST_TOKEN",
  }, [
    "exec",
    "-c", 'mcp_servers.dida365.enabled_tools=["list_tags"]',
    "--output-schema", schemaPath,
    "-o", outputPath,
    "-",
  ], { cwd: dir, input: "检查" });

  assert.equal(result.code, 0);
  assert.equal(result.provider, "claude");
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), { ok: true });
});

test("uses Claude as the primary Dida executor when configured", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-claude-primary-"));
  const codex = path.join(dir, "codex");
  const claude = path.join(dir, "claude");
  const didaConfig = path.join(dir, "dida-config.json");
  const schemaPath = path.join(dir, "schema.json");
  const outputPath = path.join(dir, "output.json");
  await writeFile(didaConfig, JSON.stringify({ access_token: "claude-primary-token" }), { mode: 0o600 });
  await writeFile(codex, "#!/usr/bin/env node\nprocess.exit(99);\n", { mode: 0o755 });
  await writeFile(claude, [
    "#!/usr/bin/env node",
    "process.stdin.resume();",
    "process.stdin.on('end', () => console.log(JSON.stringify({type:'result',structured_output:{ok:true}})));",
  ].join("\n"), { mode: 0o755 });
  await writeFile(schemaPath, JSON.stringify({
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  }));

  const result = await runCodexWithClaudeFallback({
    codexCli: codex,
    claudeCli: claude,
    claudeFallbackEnabled: true,
    didaPrimaryProvider: "claude",
    didaCliConfigPath: didaConfig,
  }, [
    "exec", "-c", 'mcp_servers.dida365.enabled_tools=["list_tags"]',
    "--output-schema", schemaPath, "-o", outputPath, "-",
  ], { cwd: dir, input: "检查" });

  assert.equal(result.code, 0);
  assert.equal(result.provider, "claude");
  assert.equal(result.primaryProvider, "claude");
});

test("falls back to Codex when the Claude Dida primary fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-codex-dida-fallback-"));
  const codex = path.join(dir, "codex");
  const claude = path.join(dir, "claude");
  const didaConfig = path.join(dir, "dida-config.json");
  const schemaPath = path.join(dir, "schema.json");
  const outputPath = path.join(dir, "output.json");
  await writeFile(didaConfig, JSON.stringify({ access_token: "codex-fallback-token" }), { mode: 0o600 });
  await writeFile(claude, "#!/usr/bin/env node\nconsole.error('Claude unavailable'); process.exit(1);\n", { mode: 0o755 });
  await writeFile(codex, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const output = args[args.indexOf('-o') + 1];",
    "fs.writeFileSync(output, JSON.stringify({ok:true}));",
  ].join("\n"), { mode: 0o755 });
  await writeFile(schemaPath, JSON.stringify({
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  }));

  const result = await runCodexWithClaudeFallback({
    codexCli: codex,
    claudeCli: claude,
    claudeFallbackEnabled: true,
    didaPrimaryProvider: "claude",
    didaCliConfigPath: didaConfig,
  }, [
    "exec", "-c", 'mcp_servers.dida365.enabled_tools=["list_tags"]',
    "--output-schema", schemaPath, "-o", outputPath, "-",
  ], { cwd: dir, input: "检查" });

  assert.equal(result.code, 0);
  assert.equal(result.provider, "codex");
  assert.equal(result.fallbackAttempted, true);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), { ok: true });
});

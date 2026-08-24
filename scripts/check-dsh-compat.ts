import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { access, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

const exec = promisify(execFile)
const projectRoot = process.cwd()
const checkout = resolve(projectRoot, process.env.DSH_CHECKOUT ?? '../deepseek-harness')
const validationHome = resolve(projectRoot, process.env.DSH_VALIDATION_HOME ?? 'var/dsh-validation')
const baseline = JSON.parse(await readFile(resolve(projectRoot, 'compat/dsh-baseline.json'), 'utf8')) as {
  version: string
  sourceCommit: string
}
const manifest = JSON.parse(await readFile(resolve(checkout, 'apps/cli/package.json'), 'utf8')) as { version?: string }
assert.equal(manifest.version, baseline.version, 'DSH checkout version differs from the compatibility baseline')
const { stdout: revision } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: checkout })
assert.equal(revision.trim(), baseline.sourceCommit, 'DSH checkout commit differs from the compatibility baseline')
await access(resolve(checkout, 'packages/interaction/commands/lib/typert.host.js'))
await access(resolve(checkout, 'packages/goal/goal/lib/typert.host.js'))

const plugin = await import(resolve(projectRoot, 'dist/index.js'))
assert.equal('default' in plugin, false, 'DSH namespace plugin must not expose a default export')
assert.equal(typeof plugin.apply, 'function', 'DSH namespace plugin must expose apply(ctx, config)')
const ledgerPlugin = await import(resolve(projectRoot, 'dist/execution/ledger-plugin.js'))
assert.equal(typeof ledgerPlugin.apply, 'function', 'DSH action ledger plugin must expose apply(ctx, config)')
const statePlugin = await import(resolve(projectRoot, 'dist/storage/plugin.js'))
assert.equal(typeof statePlugin.apply, 'function', 'DSH durable state plugin must expose apply(ctx, config)')
const workflowPlugin = await import(resolve(projectRoot, 'dist/workflow/plugin.js'))
assert.equal(typeof workflowPlugin.apply, 'function', 'DSH durable workflow plugin must expose apply(ctx, config)')
const conversationPlugin = await import(resolve(projectRoot, 'dist/conversation/dsh-effect-plugin.js'))
assert.equal(typeof conversationPlugin.apply, 'function', 'DSH conversation effect plugin must expose apply(ctx, config)')
const contextPlugin = await import(resolve(projectRoot, 'dist/lark/context-effect-plugin.js'))
assert.equal(typeof contextPlugin.apply, 'function', 'Feishu context effect plugin must expose apply(ctx, config)')
const interactionPlugin = await import(resolve(projectRoot, 'dist/intake/interaction-effect-plugin.js'))
assert.equal(typeof interactionPlugin.apply, 'function', 'intake interaction effect plugin must expose apply(ctx, config)')
const dynamicPluginPolicy = await import(resolve(projectRoot, 'dist/runtime/dynamic-plugin-policy.js'))
assert.equal(typeof dynamicPluginPolicy.apply, 'function', 'dynamic plugin approval policy must expose apply(ctx)')

const { stdout: dump } = await exec('corepack', [
  'pnpm', 'dsh', '--profile', 'feishu-assistant', '--dump-config',
], {
  cwd: checkout,
  env: {
    ...process.env,
    DSH_HOME: validationHome,
    ANTHROPIC_API_KEY: 'quark-dump-secret-sentinel',
  },
  maxBuffer: 4 * 1024 * 1024,
})
assert.match(dump, /# == @quarkfan\/quark-self-ai/)
assert.match(dump, /id: feishu-lark-cli[\s\S]*name: '@quarkfan\/quark-self-ai'/)
assert.match(dump, /id: blacklake-reference-router[\s\S]*name: '@quarkfan\/quark-self-ai\/blacklake'/)
assert.match(dump, /id: quark-executor-claude-code-read[\s\S]*permissionMode: dontAsk/)
assert.match(dump, /id: quark-executor-claude-code-write[\s\S]*permissionMode: acceptEdits/)
assert.match(dump, /process\.env\.ANTHROPIC_API_KEY/)
assert.doesNotMatch(dump, /quark-dump-secret-sentinel/, 'DSH config dump must not evaluate or expose credentials')
assert.match(dump, /id: quark-executor-codex-read[\s\S]*permissionMode: never/)
assert.match(dump, /id: quark-executor-codex-write[\s\S]*permissionMode: approve-for-me/)
assert.match(dump, /id: quark-executor-router[\s\S]*name: '@quarkfan\/quark-self-ai\/executor-router'/)
assert.match(dump, /id: quark-durable-state[\s\S]*name: '@quarkfan\/quark-self-ai\/durable-state'[\s\S]*process\.env\.SQLITE_PATH/)
assert.match(dump, /id: quark-action-ledger[\s\S]*name: '@quarkfan\/quark-self-ai\/action-ledger'/)
assert.match(dump, /id: quark-durable-workflows[\s\S]*name: '@quarkfan\/quark-self-ai\/durable-workflows'/)
assert.match(dump, /id: quark-dsh-conversation-effects[\s\S]*name: '@quarkfan\/quark-self-ai\/dsh-conversation-effects'/)
assert.match(dump, /quark-dsh-conversation-effects[\s\S]*QUARK_NATIVE_CONVERSATION_EFFECTS[\s\S]*ASSISTANT_RUNTIME === 'compat'/)
assert.match(dump, /id: quark-feishu-context-effects[\s\S]*name: '@quarkfan\/quark-self-ai\/feishu-context-effects'/)
assert.match(dump, /quark-feishu-context-effects[\s\S]*QUARK_NATIVE_FEISHU_CONTEXT_EFFECTS[\s\S]*ASSISTANT_RUNTIME === 'compat'/)
assert.match(dump, /id: quark-intake-interaction-effects[\s\S]*name: '@quarkfan\/quark-self-ai\/intake-interaction-effects'/)
assert.match(dump, /quark-intake-interaction-effects[\s\S]*QUARK_NATIVE_INTERACTION_EFFECTS[\s\S]*ASSISTANT_RUNTIME === 'compat'/)
assert.match(dump, /id: quark-feishu-ingress[\s\S]*name: '@quarkfan\/quark-self-ai\/feishu-ingress'/)
assert.match(dump, /quark-feishu-ingress[\s\S]*QUARK_NATIVE_FEISHU_INGRESS[\s\S]*ASSISTANT_RUNTIME === 'compat'[\s\S]*startConsumer: true/)
assert.match(dump, /id: quark-dynamic-plugin-policy[\s\S]*name: '@quarkfan\/quark-self-ai\/dynamic-plugin-policy'/)
assert.match(dump, /id: dsh-tool-cordis[\s\S]*name: '@deepseek-ai\/dsh-tool-cordis'/)

const ledgerPath = resolve(validationHome, 'compat-action-ledger.sqlite3')
await rm(ledgerPath, { force: true })
const activation = spawn(process.execPath, [
  '--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'feishu-assistant', '--help',
], {
  cwd: checkout,
  env: {
    ...process.env,
    DSH_HOME: validationHome,
    ASSISTANT_WORKSPACE_ROOTS: JSON.stringify([projectRoot]),
    QUARK_SQLITE_PATH: ledgerPath,
    QUARK_NATIVE_CONVERSATION_EFFECTS: 'true',
    QUARK_NATIVE_FEISHU_CONTEXT_EFFECTS: 'true',
    QUARK_NATIVE_INTERACTION_EFFECTS: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let activationOutput = ''
activation.stdout.on('data', chunk => { activationOutput += String(chunk) })
activation.stderr.on('data', chunk => { activationOutput += String(chunk) })
const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
  activation.once('error', reject)
  activation.once('exit', (code, signal) => resolveExit({ code, signal }))
})
const startup = await Promise.race([
  exited.then(result => ({ kind: 'exit' as const, result })),
  new Promise<{ kind: 'running' }>(resolveRunning => setTimeout(() => resolveRunning({ kind: 'running' }), 3_000)),
])
if (startup.kind === 'exit') {
  assert.equal(startup.result.code, 0, `DSH profile exited during activation:\n${activationOutput}`)
} else {
  activation.kill('SIGTERM')
  const stopped = await Promise.race([
    exited,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DSH profile did not stop after SIGTERM')), 10_000)),
  ])
  assert.equal(stopped.code, 0, `DSH profile did not shut down cleanly:\n${activationOutput}`)
}
assert.doesNotMatch(activationOutput, /Cannot find module|ERR_MODULE_NOT_FOUND|failed to (?:load|apply)|uncaught|fatal/i)
const ledger = new DatabaseSync(ledgerPath, { readOnly: true })
try {
  const rows = ledger.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('action_execution', 'workflow_instance', 'workflow_effect')").all()
  assert.deepEqual(rows.map(row => String(row.name)).sort(), ['action_execution', 'workflow_effect', 'workflow_instance'], 'DSH profile did not initialize the shared durable state schema')
} finally {
  ledger.close()
}
process.stdout.write(`DSH compatibility verified version=${baseline.version} commit=${baseline.sourceCommit} profile=feishu-assistant\n`)

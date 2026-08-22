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

const { stdout: dump } = await exec('corepack', [
  'pnpm', 'dsh', '--profile', 'feishu-assistant', '--dump-config',
], {
  cwd: checkout,
  env: { ...process.env, DSH_HOME: validationHome },
  maxBuffer: 4 * 1024 * 1024,
})
assert.match(dump, /# == @quarkfan\/quark-self-ai/)
assert.match(dump, /id: feishu-lark-cli[\s\S]*name: '@quarkfan\/quark-self-ai'/)
assert.match(dump, /id: blacklake-reference-router[\s\S]*name: '@quarkfan\/quark-self-ai\/blacklake'/)
assert.match(dump, /id: quark-executor-claude-code-read[\s\S]*permissionMode: dontAsk/)
assert.match(dump, /id: quark-executor-claude-code-write[\s\S]*permissionMode: acceptEdits/)
assert.match(dump, /id: quark-executor-codex-read[\s\S]*permissionMode: never/)
assert.match(dump, /id: quark-executor-codex-write[\s\S]*permissionMode: approve-for-me/)
assert.match(dump, /id: quark-executor-router[\s\S]*name: '@quarkfan\/quark-self-ai\/executor-router'/)
assert.match(dump, /id: quark-action-ledger[\s\S]*name: '@quarkfan\/quark-self-ai\/action-ledger'/)

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
  const row = ledger.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'action_execution'").get()
  assert.ok(row, 'DSH profile did not initialize the durable action ledger')
} finally {
  ledger.close()
}
process.stdout.write(`DSH compatibility verified version=${baseline.version} commit=${baseline.sourceCommit} profile=feishu-assistant\n`)

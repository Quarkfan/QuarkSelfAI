import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { toExecutorAdapterInput, validateExecutorAdapterInput } from '../src/capability-platform/validation.js'
import { ContentAddressedLocalExecutionResultStoreV1, FixedNoEffectReasoningExecutorV1, type FixedReasoningInvocationV1, type FixedReasoningProcessRunnerV1, type LocalExecutionResultSinkV1, type ReasoningExecutorIdV1 } from '../src/client-runtime/reasoning-executor-adapter.js'

const sha = `sha256:${'a'.repeat(64)}`
const now = new Date('2026-09-06T00:00:00.000Z')
const validator = { validate: validateExecutorAdapterInput }

function input(executorId: ReasoningExecutorIdV1, overrides: Record<string, unknown> = {}) {
  const envelope = {
    schemaVersion: 1 as const, tenantId: 'test.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent.demo', runId: 'run.one', actionId: 'action.one',
    blueprint: { id: 'agent/demo', version: '1.0.0', digest: sha }, program: { role: 'concise analyst', goals: ['Explain why the sky is blue'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } },
    capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.one/action.one', deadline: '2026-09-06T00:01:00.000Z',
    budget: { tokens: 1000, durationMs: 30_000, costMinorUnits: 10 }, dataClasses: ['public'], allowedEffects: [],
    executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: ['agent.execute'], allowedExecutors: ['claude-code', 'codex', 'dsh'], preferredExecutors: ['claude-code'] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const }, plan: { digest: sha, signature: 'fixture', keyId: 'test-key' },
    ...overrides,
  }
  return toExecutorAdapterInput(executorId, envelope)
}

class MemorySink implements LocalExecutionResultSinkV1 {
  content: Uint8Array | undefined
  async persist(value: { readonly content: Uint8Array }) {
    this.content = Uint8Array.from(value.content)
    return { artifactDigest: `sha256:${createHash('sha256').update(value.content).digest('hex')}` }
  }
}

test('executes one Claude reasoning-only program with fixed no-tool arguments and local-only output', async () => {
  const invocations: FixedReasoningInvocationV1[] = []
  const runner: FixedReasoningProcessRunnerV1 = { run: async invocation => { invocations.push(invocation); return { state: 'completed', exitCode: 0, stdout: JSON.stringify({ result: 'Rayleigh scattering.', account: 'must-not-project' }) } } }
  const sink = new MemorySink()
  const executor = new FixedNoEffectReasoningExecutorV1('claude-code', '/private/tmp/quark-runtime', sink, validator, runner, () => now)
  const result = await executor.execute(input('claude-code'))
  assert.deepEqual(invocations.map(({ command, args }) => ({ command, args })), [{ command: 'claude', args: ['-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--tools', '', '--no-session-persistence'] }])
  assert.match(invocations[0]!.stdin, /concise analyst/)
  assert.equal(invocations[0]!.args.includes(invocations[0]!.stdin), false)
  assert.equal(Buffer.from(sink.content!).toString(), 'Rayleigh scattering.')
  assert.deepEqual({ outcome: result.outcome, summary: result.summaryCode, artifacts: result.artifactDigests.length }, { outcome: 'succeeded', summary: 'executor.reasoning-completed', artifacts: 1 })
  assert.equal(JSON.stringify(result).includes('Rayleigh'), false)
  assert.equal(JSON.stringify(result).includes('must-not-project'), false)
})

test('parses Codex JSONL through a separate fixed read-only invocation', async () => {
  const calls: FixedReasoningInvocationV1[] = []
  const runner: FixedReasoningProcessRunnerV1 = { run: async invocation => { calls.push(invocation); return { state: 'completed', exitCode: 0, stdout: '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"Blue wavelengths scatter more."}}\n' } } }
  const sink = new MemorySink()
  const result = await new FixedNoEffectReasoningExecutorV1('codex', '/private/tmp/quark-runtime', sink, validator, runner, () => now).execute(input('codex'))
  assert.equal(calls[0]!.command, 'codex')
  assert.deepEqual(calls[0]!.args.slice(0, 4), ['exec', '--ephemeral', '--ignore-user-config', '-c'])
  assert.ok(calls[0]!.args.includes('read-only') && calls[0]!.args.includes('-'))
  assert.equal(Buffer.from(sink.content!).toString(), 'Blue wavelengths scatter more.')
  assert.equal(result.summaryCode, 'executor.reasoning-completed')
})

test('runs DSH through the fixed stdin host without placing the task in argv', async () => {
  const calls: FixedReasoningInvocationV1[] = []
  const runner: FixedReasoningProcessRunnerV1 = { run: async invocation => { calls.push(invocation); return { state: 'completed', exitCode: 0, stdout: 'Blue wavelengths scatter more.\n' } } }
  const sink = new MemorySink()
  const result = await new FixedNoEffectReasoningExecutorV1('dsh', '/private/tmp/quark-runtime', sink, validator, runner, () => now).execute(input('dsh'))
  assert.equal(calls[0]!.command, process.execPath)
  assert.equal(calls[0]!.args.length, 1)
  assert.match(calls[0]!.args[0]!, /dsh-stdin-host\.js$/)
  assert.equal(calls[0]!.args.includes(calls[0]!.stdin), false)
  assert.equal(Buffer.from(sink.content!).toString(), 'Blue wavelengths scatter more.')
  assert.equal(result.summaryCode, 'executor.reasoning-completed')
})

test('fails closed before process launch for unsigned semantic expansion or scope drift', async () => {
  let calls = 0
  const runner: FixedReasoningProcessRunnerV1 = { run: async () => { calls += 1; return { state: 'completed', exitCode: 0, stdout: '{}' } } }
  const executor = new FixedNoEffectReasoningExecutorV1('claude-code', '/private/tmp/quark-runtime', new MemorySink(), validator, runner, () => now)
  await assert.rejects(() => executor.execute(input('claude-code', { context: [{ id: 'context.one', kind: 'fixture', dataClass: 'public', location: 'local', opaqueReference: 'context:one' }] })), /no context/)
  await assert.rejects(() => executor.execute(input('claude-code', { deadline: now.toISOString() })), /expired/)
  const drifted = input('claude-code')
  await assert.rejects(() => executor.execute({ ...drifted, normalizedContextDigest: sha }), /digest drifted/)
  await assert.rejects(() => executor.execute(input('claude-code', { program: { role: 'worker', goals: ['Run something'], graph: { nodes: [{ id: 'run', capabilityId: 'tool/run', interfaceId: 'tool.run', configuration: {} }], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [{ id: 'tool/run', version: '1.0.0', artifactDigest: sha }] })), /no capability graph/)
  assert.equal(calls, 0)
})

test('persists private content-addressed results idempotently and detects tampering', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'quark-results-'))
  const root = join(await realpath(parent), 'artifacts')
  try {
    const store = await ContentAddressedLocalExecutionResultStoreV1.open(root)
    const content = Buffer.from('local result', 'utf8')
    const first = await store.persist({ runId: 'run.one', actionId: 'action.one', mediaType: 'text/plain', content })
    assert.deepEqual(await store.persist({ runId: 'run.one', actionId: 'action.one', mediaType: 'text/plain', content }), first)
    const path = join(root, first.artifactDigest.slice('sha256:'.length))
    assert.equal((await readFile(path, 'utf8')), 'local result')
    await chmod(path, 0o600)
    await writeFile(path, 'tampered')
    await assert.rejects(() => store.persist({ runId: 'run.one', actionId: 'action.one', mediaType: 'text/plain', content }), /digest drifted/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

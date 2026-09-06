import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdtemp, readdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { DeviceEnrollmentClientPortV1, DeviceSessionServerPortV1, RedactedResultV1 } from '../src/control-plane/contracts.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import type { FixedReasoningInvocationV1 } from '../src/client-runtime/reasoning-executor-adapter.js'
import { compileInactiveClientBootstrap, InactiveConfiguredLocalClientV1 } from '../src/client-runtime/configured-local-client.js'

const migration = new URL('../migrations/client-sqlite/001_client_state.sql', import.meta.url).pathname
const now = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T00:10:00.000Z'
const masterKey = new Uint8Array(32).fill(17)
const verifier = { async verify() { return true } }
const planPublicKey = `ed25519-spki:${(generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url')}`

function document(stateRoot: string) { return { schemaVersion: 1, controlPlaneEndpoint: 'https://control.example.com/', stateRoot, tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', privateKeyRef: 'secret:device.owner', keychainAccount: 'device.owner', planVerification: { keyId: 'control.primary', publicKey: planPublicKey } } as const }

function signedReasoningPlan(): SignedExecutionPlanV1 {
  const unsigned = {
    schemaVersion: 1 as const, tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', agentId: 'agent.reasoning', runId: 'run.reasoning', actionId: 'action.reasoning',
    blueprint: { id: 'agent.reasoning', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, program: { role: 'reasoner', goals: ['Return the synthetic fixture result'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: 'run.reasoning/action.reasoning',
    deadline: later, budget: { tokens: 32, durationMs: 1_000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [],
    executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: ['agent.execute'], allowedExecutors: ['dsh'], preferredExecutors: ['dsh'] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: false, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'control.primary' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'control.primary' } }
  return { schemaVersion: 1, planId: 'plan.reasoning', issuedAt: now.toISOString(), expiresAt: later, keyId: 'control.primary', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
}

test('assembles one configured client without connecting and resumes enrollment across reopen', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary)
  let begins = 0
  const enrollment: DeviceEnrollmentClientPortV1 = {
    async begin(input) { begins += 1; assert.equal(input.deviceId, 'device.owner'); return { schemaVersion: 1, requestId: `enrollment.${'a'.repeat(32)}`, userCode: 'AAAA-BBBB-CCCC-DDDD', pollToken: 'A'.repeat(43), verificationPath: '/devices/activate', expiresAt: later, pollAfterSeconds: 5 } },
    async poll(input) { return { schemaVersion: 1, requestId: input.requestId, deviceId: 'device.owner', state: 'pending', expiresAt: later } }
  }
  const sessions = { async issueChallenge() { throw new Error('unexpected network') }, async openSession() { throw new Error('unexpected network') }, async poll() { throw new Error('unexpected network') }, async acknowledge() { throw new Error('unexpected network') }, async submitResult() { throw new Error('unexpected network') } } as unknown as DeviceSessionServerPortV1
  const dependencies = { masterKeys: { async load() { return Uint8Array.from(masterKey) } }, enrollment, sessions }
  try {
    const plan = await compileInactiveClientBootstrap(document(root), migration)
    assert.deepEqual({ autoConnect: plan.autoConnect, autoPoll: plan.autoPollEnrollment, effects: plan.externalWritesEnabled }, { autoConnect: false, autoPoll: false, effects: false })
    let client = await InactiveConfiguredLocalClientV1.initialize(plan, verifier, dependencies, now)
    assert.equal(begins, 0); assert.equal(client.snapshot(now).connection, 'disconnected')
    const discovered = await client.refreshInstalledExecutors('/tmp/workspace', now, {
      runtimeRoot: '/tmp/runtime',
      versionRunner: { async run(executorId) { return { state: executorId === 'codex' ? 'not-found' as const : 'completed' as const, exitCode: executorId === 'codex' ? null : 0, output: executorId === 'codex' ? '' : '1.2.3', authentication: 'unknown' as const } } },
      authRunner: { async run() { return { state: 'completed' as const, exitCode: 0, output: JSON.stringify({ loggedIn: true }) } } },
      bundledDshDiscovery: async () => ({ schemaVersion: 1, executorId: 'dsh', installation: 'detected', version: '0.0.11', inferenceConfigured: false, authentication: 'required', protocolVersions: [], capabilities: [] }),
    })
    assert.deepEqual(discovered.map(item => [item.executorId, item.availability]), [['claude-code', 'ready'], ['codex', 'not-installed'], ['dsh', 'auth-required']])
    assert.equal(begins, 0); assert.equal(client.snapshot(now).connection, 'disconnected')
    assert.equal((await client.beginEnrollment(now)).state, 'pending'); assert.equal(begins, 1)
    await client.close()
    client = await InactiveConfiguredLocalClientV1.initialize(plan, verifier, dependencies, now)
    assert.equal((await client.beginEnrollment(now)).requestId, `enrollment.${'a'.repeat(32)}`); assert.equal(begins, 1)
    await client.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects mutable, aliased, unsafe and open-ended bootstrap input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary); const alias = `${root}-link`
  try {
    await assert.rejects(compileInactiveClientBootstrap({ ...document(root), extra: true }, migration), /document is invalid/)
    await assert.rejects(compileInactiveClientBootstrap({ ...document(root), controlPlaneEndpoint: 'http://example.com/' }, migration), /HTTPS or explicit ephemeral/)
    await chmod(root, 0o755); await assert.rejects(compileInactiveClientBootstrap(document(root), migration), /private canonical/); await chmod(root, 0o700)
    await symlink(root, alias); await assert.rejects(compileInactiveClientBootstrap(document(alias), migration), /private canonical/)
  } finally { await rm(alias, { force: true }); await rm(root, { recursive: true, force: true }) }
})

test('rejects an activated or drifted bootstrap plan before reading a master key', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary); let reads = 0
  try {
    const plan = await compileInactiveClientBootstrap(document(root), migration)
    await assert.rejects(InactiveConfiguredLocalClientV1.initialize({ ...plan, autoConnect: true as false }, verifier, { masterKeys: { async load() { reads += 1; return Uint8Array.from(masterKey) } } }, now), /not inactive/)
    await assert.rejects(InactiveConfiguredLocalClientV1.initialize({ ...plan, client: { ...plan.client, paths: { ...plan.client.paths, artifactRoot: join(root, 'elsewhere') } } }, verifier, { masterKeys: { async load() { reads += 1; return Uint8Array.from(masterKey) } } }, now), /paths drifted/)
    assert.equal(reads, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('provisions only after revalidating the same inactive bootstrap plan', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-client-')); const root = await realpath(temporary); let provisions = 0
  try {
    const plan = await compileInactiveClientBootstrap(document(root), migration)
    assert.equal(await InactiveConfiguredLocalClientV1.provisionMasterKey(plan, { async ensure() { provisions += 1; return 'created' } }), 'created')
    await assert.rejects(InactiveConfiguredLocalClientV1.provisionMasterKey({ ...plan, externalWritesEnabled: true as false }, { async ensure() { provisions += 1; return 'existing' } }), /not inactive/)
    assert.equal(provisions, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('explicitly runs the signed DSH adapter through the configured durable client without effects', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'quark-configured-reasoning-')); const root = await realpath(temporary)
  const plan = signedReasoningPlan(); let polls = 0; let invocations = 0; let submitted: RedactedResultV1 | undefined
  const sessions: DeviceSessionServerPortV1 = {
    async issueChallenge(scope) { return { schemaVersion: 1, challengeId: 'challenge.reasoning', ...scope, nonce: 'A'.repeat(43), issuedAt: now.toISOString(), expiresAt: later } },
    async openSession() { return { schemaVersion: 1, sessionId: 'session.reasoning', tenantId: 'tenant.alpha', userId: 'user.owner', deviceId: 'device.owner', issuedAt: now.toISOString(), expiresAt: later, state: 'active' } },
    async poll() { polls += 1; return polls === 1 ? { schemaVersion: 1, taskId: 'task.reasoning', planId: plan.planId, plan, deviceId: 'device.owner', leaseToken: 'L'.repeat(43), attempt: 1, leasedAt: now.toISOString(), expiresAt: later, externalWritesEnabled: false } : null },
    async acknowledge() { return { schemaVersion: 1, taskId: 'task.reasoning', planId: plan.planId, deviceId: 'device.owner', state: 'accepted', acceptedAt: now.toISOString() } },
    async submitResult(_sessionId, input) { submitted = { ...input, tenantId: 'tenant.alpha', userId: 'user.owner' }; return submitted },
  }
  try {
    const bootstrap = await compileInactiveClientBootstrap(document(root), migration)
    const client = await InactiveConfiguredLocalClientV1.initialize(bootstrap, verifier, { masterKeys: { async load() { return Uint8Array.from(masterKey) } }, sessions }, now)
    await client.refreshInstalledExecutors(root, now, {
      runtimeRoot: root,
      versionRunner: { async run(executorId) { return { state: executorId === 'dsh' ? 'completed' as const : 'not-found' as const, exitCode: executorId === 'dsh' ? 0 : null, output: executorId === 'dsh' ? '0.1.1-rc.2' : '', authentication: executorId === 'dsh' ? 'ready' as const : 'unknown' as const } } },
      authRunner: { async run() { throw new Error('auth probe must not run') } },
      bundledDshDiscovery: async () => ({ schemaVersion: 1, executorId: 'dsh', installation: 'detected', version: '0.1.1-rc.2', inferenceConfigured: true, authentication: 'ready', protocolVersions: ['envelope.v1'], capabilities: ['agent.execute'] }),
    })
    const receipt = await client.executeSignedReasoningNoEffectOnce(now, {
      clock: () => now,
      runner: { async run(invocation: FixedReasoningInvocationV1) { invocations += 1; assert.equal(invocation.executorId, 'dsh'); assert.equal(invocation.args.some(value => value.includes('synthetic fixture')), false); assert.match(invocation.stdin, /synthetic fixture/); return { state: 'completed', exitCode: 0, stdout: 'fixture result' } } },
    })
    assert.deepEqual({ state: receipt.state, executorId: receipt.executorId, invoked: receipt.executorInvoked, effects: receipt.effectsActive }, { state: 'result-synced', executorId: 'dsh', invoked: true, effects: 0 })
    assert.equal(invocations, 1); assert.equal(submitted?.summaryCode, 'executor.reasoning-completed'); assert.equal(submitted?.artifactDigests.length, 1)
    const resultFiles = await readdir(join(root, 'artifacts/reasoning-results'))
    assert.equal(resultFiles.length, 1); assert.equal(await readFile(join(root, 'artifacts/reasoning-results', resultFiles[0]!), 'utf8'), 'fixture result')
    assert.deepEqual(await readdir(join(root, 'runtime/reasoning')), [])
    await client.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { InactiveExecutorDiscoveryV1 } from '../src/client-runtime/discovery.js'
import { createInactiveClientSnapshot } from '../src/client-runtime/inactive-client.js'
import { negotiateExecutor } from '../src/client-runtime/negotiation.js'
import type { ExecutorCapabilityReportV1, SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import { validateDeviceIdentity, validateExecutorCapabilityReport, verifySignedExecutionPlan } from '../src/client-runtime/validation.js'

const now = new Date('2026-09-06T00:00:00.000Z')
const later = '2026-09-06T01:00:00.000Z'

function report(executorId: string, overrides: Partial<ExecutorCapabilityReportV1> = {}): ExecutorCapabilityReportV1 {
  return { schemaVersion: 1, deviceId: 'device.demo', executorId, availability: 'ready', version: '1.0.0', protocolVersions: ['envelope.v1'], capabilities: ['tool.execute'], constraints: [], discoveredAt: now.toISOString(), expiresAt: later, ...overrides }
}

function unsignedEnvelope() {
  return {
    schemaVersion: 1 as const, tenantId: 'tenant.demo', userId: 'user.demo', deviceId: 'device.demo', agentId: 'agent.demo', runId: 'run.001', actionId: 'action.001',
    blueprint: { id: 'agent/demo', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [],
    idempotencyKey: 'run.001/action.001', deadline: later, budget: { tokens: 100, durationMs: 1000, costMinorUnits: 1 }, dataClasses: [], allowedEffects: [],
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'sig', keyId: 'cloud-key' },
  }
}

test('inactive client owns no capability, runtime owner or write effect', () => {
  assert.deepEqual(createInactiveClientSnapshot(), { deviceId: null, connection: 'unenrolled', registeredCapabilities: 0, activeCapabilities: 0, ownedConsumers: 0, ownedProviders: 0, ownedSchedulers: 0, externalWritesEnabled: false })
  assert.equal(createInactiveClientSnapshot('device.demo').connection, 'disconnected')
})

test('validates public device identity without accepting private or host-local evidence', () => {
  const identity = { schemaVersion: 1 as const, tenantId: 'tenant.demo', userId: 'user.demo', deviceId: 'device.demo', publicKey: 'ed25519-public-material', keyAlgorithm: 'ed25519' as const, createdAt: now.toISOString(), attestation: { kind: 'self' as const, reference: 'attestation:001' } }
  assert.equal(validateDeviceIdentity(identity), identity)
  assert.throws(() => validateDeviceIdentity({ ...identity, attestation: { ...identity.attestation, reference: '/Users/demo/device' } }), /opaque public reference/)
  assert.throws(() => validateDeviceIdentity({ ...identity, publicKey: 'private_key=plaintext' }), /public key is invalid/)
})

test('discovers through injected offline probes and rejects leaked paths or mismatched identities', async () => {
  const discovery = new InactiveExecutorDiscoveryV1([{ executorId: 'executor-a', inspect: async () => report('executor-a') }])
  assert.deepEqual((await discovery.inspect('device.demo', now)).map(item => item.executorId), ['executor-a'])
  assert.throws(() => validateExecutorCapabilityReport(report('executor-a', { constraints: ['/Users/demo/bin'] })), /local path/)
  await assert.rejects(() => new InactiveExecutorDiscoveryV1([{ executorId: 'executor-a', inspect: async () => report('executor-b') }]).inspect('device.demo', now), /identity/)
})

test('negotiates a ready preferred executor and uses an explicit fallback without launching either', () => {
  const requirement = { protocolVersions: ['envelope.v1'], capabilities: ['tool.execute'], allowedExecutors: ['executor-a', 'safe-fallback'], preferredExecutors: ['executor-a'] }
  assert.equal(negotiateExecutor(requirement, [report('executor-a'), report('safe-fallback')], now).reason, 'preferred-ready')
  assert.deepEqual(negotiateExecutor(requirement, [report('executor-a', { availability: 'auth-required' }), report('safe-fallback')], now), { executorId: 'safe-fallback', reportExpiresAt: later, matchedProtocolVersion: 'envelope.v1', matchedCapabilities: ['tool.execute'], reason: 'fallback-ready' })
  assert.throws(() => negotiateExecutor(requirement, [report('executor-a', { expiresAt: now.toISOString() })], now), /no eligible executor/)
})

test('verifies a bounded signed plan and rejects envelope or signature drift', async () => {
  const base = unsignedEnvelope()
  const digest = executionEnvelopePayloadDigest(base)
  const envelope = { ...base, plan: { digest, signature: 'sig', keyId: 'cloud-key' } }
  const plan: SignedExecutionPlanV1 = { schemaVersion: 1, planId: 'plan.001', issuedAt: now.toISOString(), expiresAt: later, keyId: 'cloud-key', algorithm: 'ed25519', payloadDigest: digest, signature: 'sig', envelope }
  const accepting = { verify: async () => true }
  assert.equal(await verifySignedExecutionPlan(plan, accepting, new Date('2026-09-06T00:30:00.000Z')), plan)
  await assert.rejects(() => verifySignedExecutionPlan({ ...plan, envelope: { ...envelope, actionId: 'action.002' } }, accepting, new Date('2026-09-06T00:30:00.000Z')), /digest does not match/)
  await assert.rejects(() => verifySignedExecutionPlan(plan, { verify: async () => false }, new Date('2026-09-06T00:30:00.000Z')), /signature is invalid/)
})

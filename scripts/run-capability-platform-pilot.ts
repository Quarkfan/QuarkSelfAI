import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { executionEnvelopePayloadDigest } from '../src/capability-platform/validation.js'
import type { DeviceTaskLeaseV1, SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'
import { prepareInactiveExecutablePilotPreflight } from '../src/client-runtime/executable-pilot.js'
import { inspectAllowlistedHostExecutors } from '../src/client-runtime/host-process-probe.js'
import { classifyFixedExecutorProbe, fixedExecutorProbeSpecs } from '../src/client-runtime/process-discovery.js'
import { startLoopbackPilotServer, type LoopbackPilotReceiptV1 } from '../src/control-plane/loopback-test-server.js'

export async function runCapabilityPlatformPilot(now = new Date()) {
  const deviceId = 'device.pilot'
  const observations = await inspectAllowlistedHostExecutors()
  const reports = fixedExecutorProbeSpecs().map(spec => classifyFixedExecutorProbe(spec, observations[spec.executorId], deviceId, now))
  const preflight = prepareInactiveExecutablePilotPreflight({ tenantId: 'test.pilot', deviceId, reports }, now)
  const lease = signedNoEffectLease(now)
  const server = await startLoopbackPilotServer({ verify: async ({ payloadDigest, signature }) => signature === `signed:${payloadDigest}` }, () => now)
  let receipt: LoopbackPilotReceiptV1
  try {
    const response = await fetch(`http://${server.host}:${server.port}/v1/pilot/lease`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lease, executorId: preflight.selectedExecutorId ?? 'dsh' }),
    })
    if (!response.ok) throw new Error(`loopback pilot returned status ${response.status}`)
    receipt = await response.json() as LoopbackPilotReceiptV1
  } finally {
    await server.close()
  }
  return Object.freeze({
    schemaVersion: 1,
    requestId: 'capability-platform-executable-pilot-01',
    probeReports: reports.map(({ executorId, availability, version }) => ({ executorId, availability, version })),
    preflight,
    transport: { kind: 'loopback-http', addressClass: 'ipv4-loopback', ephemeralPort: true, stopped: true },
    receipt,
    executorInvoked: false,
    effectsActive: 0,
    currentOwnerPreserved: true,
  })
}

function signedNoEffectLease(now: Date): DeviceTaskLeaseV1 {
  const expiresAt = new Date(now.getTime() + 60_000).toISOString()
  const unsigned = {
    schemaVersion: 1 as const, tenantId: 'test.pilot', userId: 'user.pilot', deviceId: 'device.pilot', agentId: 'agent/pilot', runId: 'run.pilot', actionId: 'action.pilot',
    blueprint: { id: 'agent/pilot', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` }, capabilities: [], context: [], workspaceGrants: [], approvalGrants: [],
    idempotencyKey: 'run.pilot/action.pilot', deadline: expiresAt, budget: { tokens: 0, durationMs: 1_000, costMinorUnits: 0 }, dataClasses: ['public'], allowedEffects: [],
    executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: [], allowedExecutors: ['claude-code', 'codex', 'dsh'], preferredExecutors: ['claude-code', 'codex'] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: true, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'test-key' },
  }
  const digest = executionEnvelopePayloadDigest(unsigned)
  const envelope = { ...unsigned, plan: { digest, signature: `signed:${digest}`, keyId: 'test-key' } }
  const plan: SignedExecutionPlanV1 = { schemaVersion: 1, planId: 'plan.pilot', issuedAt: now.toISOString(), expiresAt, keyId: 'test-key', algorithm: 'ed25519', payloadDigest: digest, signature: `signed:${digest}`, envelope }
  return { schemaVersion: 1, taskId: 'task.pilot', planId: plan.planId, plan, deviceId: 'device.pilot', leaseToken: 'lease.pilot', attempt: 1, leasedAt: now.toISOString(), expiresAt, externalWritesEnabled: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCapabilityPlatformPilot().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`), error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  })
}

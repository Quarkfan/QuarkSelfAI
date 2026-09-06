import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { executionEnvelopePayloadDigest, toExecutorAdapterInput, validateExecutorAdapterInput } from '../src/capability-platform/validation.js'
import { inspectExecutorReadiness } from '../src/client-runtime/executor-readiness-probe.js'
import { discoverBundledDsh } from '../src/client-runtime/bundled-dsh-discovery.js'
import { ContentAddressedLocalExecutionResultStoreV1, FixedNoEffectReasoningExecutorV1, type ReasoningExecutorIdV1 } from '../src/client-runtime/reasoning-executor-adapter.js'
import { verifySignedExecutionPlan } from '../src/client-runtime/validation.js'
import type { SignedExecutionPlanV1 } from '../src/client-runtime/contracts.js'

interface PilotReadinessV1 {
  readonly executorId: ReasoningExecutorIdV1
  readonly installation: 'detected' | 'not-detected' | 'package-drift'
  readonly authentication: 'ready' | 'required' | 'unknown'
}

interface ReasoningExecutorPilotDependenciesV1 {
  readonly inspectReadiness?: (runtimeDirectory: string, now: Date) => Promise<readonly PilotReadinessV1[]>
  readonly execute?: (input: { readonly executorId: ReasoningExecutorIdV1; readonly runtimeDirectory: string; readonly resultDirectory: string; readonly plan: SignedExecutionPlanV1 }) => Promise<{ readonly outcome: 'succeeded'; readonly summaryCode: string; readonly artifactDigests: readonly string[] }>
  readonly temporaryParent?: string
}

export async function runReasoningExecutorPilot(now = new Date(), requestedExecutorId?: ReasoningExecutorIdV1, dependencies: ReasoningExecutorPilotDependenciesV1 = {}) {
  if (Number.isNaN(now.getTime())) throw new Error('pilot timestamp is invalid')
  const root = await realpath(await mkdtemp(join(dependencies.temporaryParent ?? tmpdir(), 'quark-reasoning-pilot-')))
  await chmod(root, 0o700)
  const runtime = join(root, 'runtime')
  const results = join(root, 'results')
  await mkdir(runtime, { mode: 0o700 })
  try {
    const readiness = await (dependencies.inspectReadiness ?? inspectPilotReadiness)(runtime, now)
    const executorId = requestedExecutorId ?? (['claude-code', 'codex', 'dsh'] as const).find(id => readiness.some(item => item.executorId === id && item.installation === 'detected' && item.authentication === 'ready')) ?? null
    if (!executorId) throw new Error('no authenticated reasoning executor is ready')
    if (!readiness.some(item => item.executorId === executorId && item.installation === 'detected' && item.authentication === 'ready')) throw new Error('requested reasoning executor is not authenticated and ready')
    const plan = signedPlan(executorId, now)
    await verifySignedExecutionPlan(plan.value, plan.verifier, now)
    const result = dependencies.execute
      ? await dependencies.execute({ executorId, runtimeDirectory: runtime, resultDirectory: results, plan: plan.value })
      : await executeWithProductAdapter(executorId, runtime, results, plan.value)
    const artifactDigest = result.artifactDigests[0]
    if (!artifactDigest) throw new Error('reasoning executor did not persist a local result')
    return Object.freeze({
      schemaVersion: 1,
      requestId: `capability-platform-reasoning-executor-pilot-03-${executorId}`,
      inputClass: 'fixed-public-synthetic',
      executorId,
      outcome: result.outcome,
      summaryCode: result.summaryCode,
      artifactDigest,
      artifactContentProjected: false,
      promptInArgv: false,
      toolsEnabled: false,
      workspaceGranted: false,
      contextGranted: false,
      externalWritesEnabled: false,
      effectsActive: 0,
      currentOwnerPreserved: true,
      runtimeCompositionChanged: false,
      temporaryStateRemoved: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function inspectPilotReadiness(runtime: string, now: Date): Promise<readonly PilotReadinessV1[]> {
  const projectRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)))
  const [installed, dsh] = await Promise.all([inspectExecutorReadiness(runtime, now), discoverBundledDsh(projectRoot)])
  return Object.freeze([...installed, { executorId: 'dsh', installation: dsh.installation, authentication: dsh.authentication }])
}

async function executeWithProductAdapter(executorId: ReasoningExecutorIdV1, runtime: string, results: string, plan: SignedExecutionPlanV1) {
  const store = await ContentAddressedLocalExecutionResultStoreV1.open(results)
  const adapter = new FixedNoEffectReasoningExecutorV1(executorId, runtime, store, { validate: validateExecutorAdapterInput })
  return await adapter.execute(toExecutorAdapterInput(executorId, plan.envelope))
}

function signedPlan(executorId: ReasoningExecutorIdV1, now: Date): { readonly value: SignedExecutionPlanV1; readonly verifier: { verify(input: { readonly payloadDigest: string; readonly signature: string }): Promise<boolean> } } {
  const expiresAt = new Date(now.getTime() + 150_000).toISOString()
  const sha = `sha256:${'a'.repeat(64)}`
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const unsigned = {
    schemaVersion: 1 as const, tenantId: 'test.pilot', userId: 'user.pilot', deviceId: 'device.pilot', agentId: 'agent.reasoning', runId: `run.${executorId}`, actionId: `action.${executorId}`,
    blueprint: { id: 'agent/reasoning', version: '1.0.0', digest: sha },
    program: { role: 'concise science explainer', goals: ['Explain in one sentence why the daytime sky appears blue.'], graph: { nodes: [], edges: [] }, modelPolicy: { allowed: ['provider-neutral'], preferred: null } },
    capabilities: [], context: [], workspaceGrants: [], approvalGrants: [], idempotencyKey: `run.${executorId}/action.${executorId}`, deadline: expiresAt,
    budget: { tokens: 256, durationMs: 120_000, costMinorUnits: 1 }, dataClasses: ['public'], allowedEffects: [],
    executorRequirement: { protocolVersions: ['envelope.v1'], capabilities: ['agent.execute'], allowedExecutors: [executorId], preferredExecutors: [executorId] },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: false, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: 'pilot-key' },
  }
  const payloadDigest = executionEnvelopePayloadDigest(unsigned)
  const signature = sign(null, Buffer.from(payloadDigest, 'utf8'), privateKey).toString('base64url')
  const envelope = { ...unsigned, plan: { digest: payloadDigest, signature, keyId: 'pilot-key' } }
  const value: SignedExecutionPlanV1 = { schemaVersion: 1, planId: `plan.${executorId}`, issuedAt: now.toISOString(), expiresAt, keyId: 'pilot-key', algorithm: 'ed25519', payloadDigest, signature, envelope }
  return { value, verifier: { verify: async input => input.payloadDigest === payloadDigest && input.signature === signature && verify(null, Buffer.from(input.payloadDigest, 'utf8'), publicKey, Buffer.from(input.signature, 'base64url')) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = process.argv[2]
  const requested = option === undefined ? undefined : option === '--executor=claude-code' ? 'claude-code' : option === '--executor=codex' ? 'codex' : option === '--executor=dsh' ? 'dsh' : null
  if (requested === null) throw new Error('pilot accepts only --executor=claude-code, --executor=codex or --executor=dsh')
  runReasoningExecutorPilot(new Date(), requested).then(receipt => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`), error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'pilot failed' })}\n`)
    process.exitCode = 1
  })
}

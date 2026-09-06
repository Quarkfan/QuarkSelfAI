import type { AgentBlueprintV1 } from '../capability-platform/blueprint.js'
import type { ExecutionContextReferenceV1 } from '../capability-platform/execution-envelope.js'
import type { CapabilityManifestV1 } from '../capability-platform/manifest.js'
import type { WorkspaceGrantV1 } from '../capability-platform/permissions.js'
import { blueprintPayloadDigest, executionEnvelopePayloadDigest, validateAgentBlueprint, validateCapabilityManifest } from '../capability-platform/validation.js'
import type { SignedExecutionPlanV1 } from '../client-runtime/contracts.js'
import type { ExecutionPlanSignerV1 } from '../control-plane/contracts.js'

export interface TestPlanCompilationInputV1 {
  readonly tenantId: string
  readonly userId: string
  readonly deviceId: string
  readonly runId: string
  readonly actionId: string
  readonly planId: string
  readonly idempotencyKey: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly context: readonly ExecutionContextReferenceV1[]
  readonly workspaceGrants: readonly WorkspaceGrantV1[]
}

function versionMatches(version: string, range: string): boolean {
  if (range === version) return true
  if (range.startsWith('^')) return version.split('.')[0] === range.slice(1).split('.')[0]
  return false
}

export async function compileTestExecutionPlan(
  blueprintInput: unknown,
  manifestInputs: readonly unknown[],
  input: TestPlanCompilationInputV1,
  signer: ExecutionPlanSignerV1,
): Promise<SignedExecutionPlanV1> {
  const blueprint = validateAgentBlueprint(blueprintInput)
  if (blueprintPayloadDigest(blueprint) !== blueprint.digest) throw new Error('blueprint digest does not match its payload')
  if (!input.tenantId.startsWith('test.')) throw new Error('inactive compiler accepts test tenants only')
  if (blueprint.permissions.some(permission => permission.kind === 'external-effect' || permission.effect?.externalWrite)) throw new Error('inactive compiler rejects external effects')
  const manifests = manifestInputs.map(validateCapabilityManifest)
  const selected = blueprint.capabilities.map(reference => {
    const matches = manifests.filter(manifest => manifest.id === reference.id && manifest.source.artifactDigest === reference.artifactDigest && versionMatches(manifest.version, reference.versionRange))
    if (matches.length !== 1) throw new Error(`blueprint capability ${reference.id} must resolve to exactly one verified artifact`)
    return matches[0]!
  })
  const byId = new Map(selected.map(manifest => [manifest.id, manifest]))
  for (const node of blueprint.graph.nodes) {
    const manifest = byId.get(node.capabilityId)
    if (!manifest) throw new Error(`blueprint node ${node.id} references an unresolved capability`)
    if (!manifest.interfaces.some(candidate => candidate.direction === 'provides' && candidate.id === node.interfaceId)) throw new Error(`blueprint node ${node.id} references an interface not provided by its capability`)
  }
  topologicalOrder(blueprint)
  const workspaceHandles = new Set(input.workspaceGrants.map(grant => grant.handle))
  if (blueprint.workspaceHandles.some(handle => !workspaceHandles.has(handle))) throw new Error('blueprint workspace handle is not granted to this action')
  const unsigned = {
    schemaVersion: 1 as const,
    tenantId: input.tenantId,
    userId: input.userId,
    deviceId: input.deviceId,
    agentId: blueprint.id,
    runId: input.runId,
    actionId: input.actionId,
    blueprint: { id: blueprint.id, version: blueprint.version, digest: blueprint.digest },
    program: {
      role: blueprint.role,
      goals: [...blueprint.goals],
      graph: {
        nodes: blueprint.graph.nodes.map(node => ({ ...node, configuration: structuredClone(node.configuration) })),
        edges: blueprint.graph.edges.map(edge => ({ ...edge })),
      },
      modelPolicy: { allowed: [...blueprint.modelPolicy.allowed], preferred: blueprint.modelPolicy.preferred },
    },
    capabilities: selected.map(manifest => ({ id: manifest.id, version: manifest.version, artifactDigest: manifest.source.artifactDigest })),
    context: [...input.context],
    workspaceGrants: [...input.workspaceGrants],
    approvalGrants: [],
    idempotencyKey: input.idempotencyKey,
    deadline: input.expiresAt,
    budget: blueprint.budget,
    dataClasses: [...new Set(selected.flatMap(manifest => manifest.dataClasses))],
    allowedEffects: [],
    executorRequirement: {
      protocolVersions: ['envelope.v1'],
      capabilities: [...new Set(selected.flatMap(manifest => manifest.runtime.executorRequirements))].sort(),
      allowedExecutors: [...blueprint.executorPolicy.preferred, ...blueprint.executorPolicy.fallback],
      preferredExecutors: [...blueprint.executorPolicy.preferred],
    },
    continuity: { sessionId: null, continuationToken: null, fallbackAllowed: blueprint.executorPolicy.allowInfrastructureFallback, midActionSwitchAllowed: false as const },
    plan: { digest: `sha256:${'0'.repeat(64)}`, signature: 'unsigned', keyId: signer.keyId },
  }
  const payloadDigest = executionEnvelopePayloadDigest(unsigned)
  const signature = await signer.sign({ algorithm: 'ed25519', payloadDigest })
  if (!signature) throw new Error('plan signer returned an empty signature')
  const envelope = { ...unsigned, plan: { digest: payloadDigest, signature, keyId: signer.keyId } }
  return { schemaVersion: 1, planId: input.planId, issuedAt: input.issuedAt, expiresAt: input.expiresAt, keyId: signer.keyId, algorithm: 'ed25519', payloadDigest, signature, envelope }
}

function topologicalOrder(blueprint: AgentBlueprintV1): readonly string[] {
  const indegree = new Map(blueprint.graph.nodes.map(node => [node.id, 0]))
  const outgoing = new Map(blueprint.graph.nodes.map(node => [node.id, [] as string[]]))
  for (const edge of blueprint.graph.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort()
  const ordered: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    ordered.push(id)
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
    queue.sort()
  }
  if (ordered.length !== blueprint.graph.nodes.length) throw new Error('blueprint capability graph contains a cycle')
  return ordered
}

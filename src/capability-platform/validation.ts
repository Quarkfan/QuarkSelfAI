import { createHash } from 'node:crypto'
import type { AgentBlueprintV1 } from './blueprint.js'
import type { ExecutionEnvelopeV1, ExecutorAdapterInputV1 } from './execution-envelope.js'
import type { CapabilityManifestV1 } from './manifest.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}(?:\/[a-z0-9][a-z0-9.-]{0,63})?$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const absolutePathPattern = /^(?:\/|[A-Za-z]:[\\/]|~(?:[\\/]|$))/
const secretAssignmentPattern = /(?:token|secret|password|private[_-]?key)\s*[:=]/i

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string up to ${max} characters`)
  return value
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 129)
  if (!idPattern.test(result)) throw new Error(`${label} is invalid`)
  return result
}

function version(value: unknown, label: string): string {
  const result = text(value, label, 100)
  if (!versionPattern.test(result)) throw new Error(`${label} must be semantic version`)
  return result
}

function digest(value: unknown, label: string): string {
  const result = text(value, label, 80)
  if (!digestPattern.test(result)) throw new Error(`${label} must be a sha256 digest`)
  return result
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 100)
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`)
  return result
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON rejects non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    const keys = Object.keys(object).sort()
    if (keys.some(key => object[key] === undefined)) throw new Error('canonical JSON rejects undefined values')
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  throw new Error(`canonical JSON rejects ${typeof value}`)
}

export function contentDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function validatePermission(value: unknown, placement: readonly string[], label: string): void {
  const permission = record(value, label)
  identifier(permission.id, `${label}.id`)
  const kind = text(permission.kind, `${label}.kind`)
  const operations = array(permission.operations, `${label}.operations`).map((item, index) => text(item, `${label}.operations[${index}]`))
  if (!operations.length) throw new Error(`${label}.operations cannot be empty`)
  unique(operations, `${label}.operations`)
  const scope = text(permission.scope, `${label}.scope`, 500)
  if (absolutePathPattern.test(scope)) throw new Error(`${label}.scope must use an opaque handle, not an absolute path`)
  if (secretAssignmentPattern.test(scope)) throw new Error(`${label}.scope cannot contain secret-shaped values`)
  if (!placement.includes(text(permission.placement, `${label}.placement`))) throw new Error(`${label}.placement is not supported by the capability`)
  const approval = text(permission.approval, `${label}.approval`)
  const effect = permission.effect === undefined ? undefined : record(permission.effect, `${label}.effect`)
  if (kind === 'external-effect') {
    if (!effect || effect.externalWrite !== true || effect.writeVerificationRequired !== true || approval !== 'action') {
      throw new Error(`${label} external effects require action approval and write verification`)
    }
  } else if (effect?.externalWrite === true) {
    throw new Error(`${label} external writes must use kind external-effect`)
  }
}

export function validateCapabilityManifest(value: unknown): CapabilityManifestV1 {
  const manifest = record(value, 'manifest')
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1')
  identifier(manifest.id, 'manifest.id')
  text(manifest.name, 'manifest.name', 200)
  version(manifest.version, 'manifest.version')
  text(manifest.kind, 'manifest.kind')
  text(manifest.description, 'manifest.description', 2000)
  const source = record(manifest.source, 'manifest.source')
  text(source.kind, 'manifest.source.kind')
  const locator = text(source.locator, 'manifest.source.locator', 1000)
  if (absolutePathPattern.test(locator)) throw new Error('manifest.source.locator must be portable')
  text(source.revision, 'manifest.source.revision', 200)
  digest(source.artifactDigest, 'manifest.source.artifactDigest')
  text(source.license, 'manifest.source.license', 100)
  text(source.supplier, 'manifest.source.supplier', 200)
  const signature = record(source.signature, 'manifest.source.signature')
  if (!['verified', 'missing', 'invalid'].includes(text(signature.status, 'manifest.source.signature.status'))) throw new Error('manifest.source.signature.status is invalid')
  const runtime = record(manifest.runtime, 'manifest.runtime')
  const placements = array(runtime.placements, 'manifest.runtime.placements').map((item, index) => text(item, `manifest.runtime.placements[${index}]`))
  if (!placements.length || placements.some(item => !['local', 'cloud', 'hybrid'].includes(item))) throw new Error('manifest.runtime.placements is invalid')
  unique(placements, 'manifest.runtime.placements')
  identifier(runtime.stateNamespace, 'manifest.runtime.stateNamespace')
  if (runtime.offlineCapable === true && !placements.includes('local') && !placements.includes('hybrid')) throw new Error('offline capability requires local or hybrid placement')
  const requirements = array(manifest.requirements, 'manifest.requirements')
  const requirementKeys = requirements.map((item, index) => {
    const requirement = record(item, `manifest.requirements[${index}]`)
    const kind = text(requirement.kind, `manifest.requirements[${index}].kind`)
    if (!['system', 'model', 'executor', 'package', 'network', 'device', 'capability'].includes(kind)) throw new Error('manifest requirement kind is invalid')
    const placement = text(requirement.placement, `manifest.requirements[${index}].placement`)
    if (!placements.includes(placement)) throw new Error('manifest requirement placement is not supported by the capability')
    return `${kind}:${identifier(requirement.id, `manifest.requirements[${index}].id`)}:${placement}`
  })
  unique(requirementKeys, 'manifest.requirements')
  const lifecycle = record(manifest.lifecycle, 'manifest.lifecycle')
  const lifecycleActions = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover']
  if (Object.keys(lifecycle).sort().join(',') !== [...lifecycleActions].sort().join(',')) throw new Error('manifest lifecycle must declare every supported action exactly once')
  for (const action of lifecycleActions) {
    const handler = record(lifecycle[action], `manifest.lifecycle.${action}`)
    identifier(handler.handlerInterface, `manifest.lifecycle.${action}.handlerInterface`)
    if (typeof handler.supported !== 'boolean' || !['none', 'install', 'session', 'action'].includes(text(handler.approval, `manifest.lifecycle.${action}.approval`))) throw new Error(`manifest.lifecycle.${action} is invalid`)
  }
  const interfaces = array(manifest.interfaces, 'manifest.interfaces').map((item, index) => {
    const entry = record(item, `manifest.interfaces[${index}]`)
    return `${text(entry.kind, `manifest.interfaces[${index}].kind`)}:${identifier(entry.id, `manifest.interfaces[${index}].id`)}:${text(entry.direction, `manifest.interfaces[${index}].direction`)}`
  })
  unique(interfaces, 'manifest.interfaces')
  const dependencies = array(manifest.dependencies, 'manifest.dependencies').map((item, index) => identifier(record(item, `manifest.dependencies[${index}]`).id, `manifest.dependencies[${index}].id`))
  unique(dependencies, 'manifest.dependencies')
  if (dependencies.includes(manifest.id as string)) throw new Error('manifest cannot depend on itself')
  const permissions = array(manifest.permissions, 'manifest.permissions')
  permissions.forEach((item, index) => validatePermission(item, placements, `manifest.permissions[${index}]`))
  const permissionIds = permissions.map((item, index) => identifier(record(item, `manifest.permissions[${index}]`).id, `manifest.permissions[${index}].id`))
  unique(permissionIds, 'manifest.permissions')
  const tests = array(manifest.tests, 'manifest.tests')
  if (!tests.some(item => record(item, 'manifest.tests item').kind === 'contract' && record(item, 'manifest.tests item').required === true)) throw new Error('manifest requires a contract test')
  if (tests.some(item => !['none', 'recording-sink'].includes(text(record(item, 'manifest.tests item').effectMode, 'manifest.tests.effectMode')))) throw new Error('manifest tests cannot enable effects')
  const healthCheckIds = array(manifest.healthChecks, 'manifest.healthChecks').map((item, index) => {
    const check = record(item, `manifest.healthChecks[${index}]`)
    const placement = text(check.placement, `manifest.healthChecks[${index}].placement`)
    if (!placements.includes(placement)) throw new Error('manifest health check placement is not supported by the capability')
    if (!Number.isSafeInteger(check.timeoutMs) || Number(check.timeoutMs) <= 0) throw new Error('manifest health check timeout must be a positive integer')
    identifier(check.interfaceId, `manifest.healthChecks[${index}].interfaceId`)
    return identifier(check.id, `manifest.healthChecks[${index}].id`)
  })
  unique(healthCheckIds, 'manifest.healthChecks')
  const recovery = record(manifest.recovery, 'manifest.recovery')
  if (recovery.restoreEffectsEnabled !== false) throw new Error('manifest recovery must restore with effects disabled')
  return value as CapabilityManifestV1
}

export function validateAgentBlueprint(value: unknown): AgentBlueprintV1 {
  const blueprint = record(value, 'blueprint')
  if (blueprint.schemaVersion !== 1) throw new Error('blueprint.schemaVersion must be 1')
  identifier(blueprint.id, 'blueprint.id')
  version(blueprint.version, 'blueprint.version')
  digest(blueprint.digest, 'blueprint.digest')
  const capabilities = array(blueprint.capabilities, 'blueprint.capabilities').map((item, index) => identifier(record(item, `blueprint.capabilities[${index}]`).id, `blueprint.capabilities[${index}].id`))
  unique(capabilities, 'blueprint.capabilities')
  const graph = record(blueprint.graph, 'blueprint.graph')
  const nodes = array(graph.nodes, 'blueprint.graph.nodes').map((item, index) => identifier(record(item, `blueprint.graph.nodes[${index}]`).id, `blueprint.graph.nodes[${index}].id`))
  unique(nodes, 'blueprint.graph.nodes')
  const nodeSet = new Set(nodes)
  for (const [index, value] of array(graph.edges, 'blueprint.graph.edges').entries()) {
    const edge = record(value, `blueprint.graph.edges[${index}]`)
    if (!nodeSet.has(text(edge.from, `blueprint.graph.edges[${index}].from`)) || !nodeSet.has(text(edge.to, `blueprint.graph.edges[${index}].to`))) throw new Error('blueprint graph edge references an unknown node')
  }
  const executorPolicy = record(blueprint.executorPolicy, 'blueprint.executorPolicy')
  if (executorPolicy.allowMidActionSwitch !== false || executorPolicy.preserveSessionContinuity !== true) throw new Error('blueprint executor policy must preserve action and session continuity')
  const retry = record(blueprint.retry, 'blueprint.retry')
  if (retry.deterministicAttempts !== 1) throw new Error('deterministic failures cannot be retried on another executor')
  const permissions = array(blueprint.permissions, 'blueprint.permissions')
  permissions.forEach((item, index) => validatePermission(item, ['local', 'cloud', 'hybrid'], `blueprint.permissions[${index}]`))
  return value as AgentBlueprintV1
}

export function validateExecutionEnvelope(value: unknown): ExecutionEnvelopeV1 {
  const envelope = record(value, 'envelope')
  if (envelope.schemaVersion !== 1) throw new Error('envelope.schemaVersion must be 1')
  for (const field of ['tenantId', 'userId', 'deviceId', 'agentId', 'runId', 'actionId'] as const) identifier(envelope[field], `envelope.${field}`)
  const blueprint = record(envelope.blueprint, 'envelope.blueprint')
  identifier(blueprint.id, 'envelope.blueprint.id')
  version(blueprint.version, 'envelope.blueprint.version')
  digest(blueprint.digest, 'envelope.blueprint.digest')
  const capabilities = array(envelope.capabilities, 'envelope.capabilities')
  for (const [index, value] of capabilities.entries()) digest(record(value, `envelope.capabilities[${index}]`).artifactDigest, `envelope.capabilities[${index}].artifactDigest`)
  const context = array(envelope.context, 'envelope.context')
  for (const [index, value] of context.entries()) {
    const reference = record(value, `envelope.context[${index}]`)
    const opaque = text(reference.opaqueReference, `envelope.context[${index}].opaqueReference`)
    if (absolutePathPattern.test(opaque) || secretAssignmentPattern.test(opaque)) throw new Error('execution context must use opaque references without local paths or secrets')
  }
  const workspaceGrants = array(envelope.workspaceGrants, 'envelope.workspaceGrants')
  for (const [index, value] of workspaceGrants.entries()) {
    const grant = record(value, `envelope.workspaceGrants[${index}]`)
    const handle = text(grant.handle, `envelope.workspaceGrants[${index}].handle`)
    if (absolutePathPattern.test(handle)) throw new Error('workspace grant must use an opaque handle')
    timestamp(grant.expiresAt, `envelope.workspaceGrants[${index}].expiresAt`)
  }
  const approvalGrants = array(envelope.approvalGrants, 'envelope.approvalGrants')
  const effectSet = new Set(array(envelope.allowedEffects, 'envelope.allowedEffects').map((item, index) => text(item, `envelope.allowedEffects[${index}]`)))
  for (const [index, value] of approvalGrants.entries()) {
    const grant = record(value, `envelope.approvalGrants[${index}]`)
    if (grant.tenantId !== envelope.tenantId || grant.userId !== envelope.userId || grant.deviceId !== envelope.deviceId || grant.agentId !== envelope.agentId || grant.actionId !== envelope.actionId) throw new Error('approval grant scope does not match execution envelope')
    if (!effectSet.has(text(grant.effectKind, `envelope.approvalGrants[${index}].effectKind`))) throw new Error('approval grant effect is not declared by the envelope')
    const grantedAt = timestamp(grant.grantedAt, `envelope.approvalGrants[${index}].grantedAt`)
    const expiresAt = timestamp(grant.expiresAt, `envelope.approvalGrants[${index}].expiresAt`)
    if (Date.parse(expiresAt) <= Date.parse(grantedAt)) throw new Error('approval grant must expire after it is granted')
  }
  text(envelope.idempotencyKey, 'envelope.idempotencyKey', 300)
  timestamp(envelope.deadline, 'envelope.deadline')
  const continuity = record(envelope.continuity, 'envelope.continuity')
  if (continuity.midActionSwitchAllowed !== false) throw new Error('execution envelope cannot allow mid-action switching')
  const plan = record(envelope.plan, 'envelope.plan')
  digest(plan.digest, 'envelope.plan.digest')
  text(plan.signature, 'envelope.plan.signature', 1000)
  text(plan.keyId, 'envelope.plan.keyId', 300)
  return value as ExecutionEnvelopeV1
}

export function toExecutorAdapterInput(executorId: string, value: unknown): ExecutorAdapterInputV1 {
  const envelope = validateExecutionEnvelope(value)
  return { executorId: identifier(executorId, 'executorId'), envelope, normalizedContextDigest: contentDigest(envelope) }
}

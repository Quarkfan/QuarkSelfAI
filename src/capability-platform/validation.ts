import { createHash } from 'node:crypto'
import type { AgentBlueprintV1 } from './blueprint.js'
import type { ExecutionEnvelopeV1, ExecutorAdapterInputV1 } from './execution-envelope.js'
import type { CapabilityManifestV1 } from './manifest.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}(?:\/[a-z0-9][a-z0-9.-]{0,63})?$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const digestPattern = /^sha256:[a-f0-9]{64}$/
const absolutePathPattern = /^(?:\/|[A-Za-z]:[\\/]|~(?:[\\/]|$))/
const secretAssignmentPattern = /(?:token|secret|password|private[_-]?key)\s*[:=]/i
const capabilityKinds = new Set(['skill', 'knowledge', 'policy', 'workflow', 'connector', 'package', 'sdk', 'cli', 'binary', 'project', 'browser-runtime', 'container', 'notebook', 'sandbox', 'application', 'game', 'simulation', 'integration-pack', 'agent', 'composite'])
const sourceKinds = new Set(['git', 'registry', 'local-build', 'first-party'])
const isolationKinds = new Set(['pure', 'process', 'container', 'browser-profile', 'vm', 'remote-service'])
const interfaceKinds = new Set(['tool', 'port', 'event', 'resource', 'ui', 'runtime', 'experience'])
const permissionKinds = new Set(['workspace', 'file', 'browser', 'desktop', 'network', 'secret-reference', 'process', 'container', 'gpu', 'port', 'data', 'external-effect'])
const permissionOperations = new Set(['discover', 'read', 'write', 'execute', 'connect', 'listen', 'render', 'persist'])
const approvalKinds = new Set(['none', 'install', 'session', 'action'])

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

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`${label} has unknown fields: ${unknown.join(',')}`)
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

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function optionalText(value: unknown, label: string, max = 500): string | undefined {
  return value === undefined ? undefined : text(value, label, max)
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

export function blueprintPayloadDigest(value: AgentBlueprintV1): string {
  const { digest: _digest, ...payload } = value
  return contentDigest(payload)
}

export function executionEnvelopePayloadDigest(value: ExecutionEnvelopeV1): string {
  const envelope = validateExecutionEnvelope(value)
  const { plan: _signatureMetadata, ...payload } = envelope
  return contentDigest(payload)
}

function validatePermission(value: unknown, placement: readonly string[], label: string): void {
  const permission = record(value, label)
  exactKeys(permission, ['id', 'kind', 'operations', 'scope', 'placement', 'approval', 'required', 'dataClasses', 'effect'], label)
  identifier(permission.id, `${label}.id`)
  const kind = text(permission.kind, `${label}.kind`)
  if (!permissionKinds.has(kind)) throw new Error(`${label}.kind is invalid`)
  const operations = array(permission.operations, `${label}.operations`).map((item, index) => text(item, `${label}.operations[${index}]`))
  if (!operations.length) throw new Error(`${label}.operations cannot be empty`)
  if (operations.some(operation => !permissionOperations.has(operation))) throw new Error(`${label}.operations is invalid`)
  unique(operations, `${label}.operations`)
  const scope = text(permission.scope, `${label}.scope`, 500)
  if (absolutePathPattern.test(scope)) throw new Error(`${label}.scope must use an opaque handle, not an absolute path`)
  if (secretAssignmentPattern.test(scope)) throw new Error(`${label}.scope cannot contain secret-shaped values`)
  if (!placement.includes(text(permission.placement, `${label}.placement`))) throw new Error(`${label}.placement is not supported by the capability`)
  const approval = text(permission.approval, `${label}.approval`)
  if (!approvalKinds.has(approval)) throw new Error(`${label}.approval is invalid`)
  boolean(permission.required, `${label}.required`)
  const permissionDataClasses = array(permission.dataClasses, `${label}.dataClasses`).map((item, index) => text(item, `${label}.dataClasses[${index}]`, 100))
  unique(permissionDataClasses, `${label}.dataClasses`)
  const effect = permission.effect === undefined ? undefined : record(permission.effect, `${label}.effect`)
  if (effect) exactKeys(effect, ['kind', 'externalWrite', 'writeVerificationRequired'], `${label}.effect`)
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
  exactKeys(manifest, ['schemaVersion', 'id', 'name', 'version', 'kind', 'description', 'source', 'runtime', 'requirements', 'lifecycle', 'interfaces', 'dependencies', 'permissions', 'dataClasses', 'tests', 'healthChecks', 'recovery'], 'manifest')
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1')
  identifier(manifest.id, 'manifest.id')
  text(manifest.name, 'manifest.name', 200)
  version(manifest.version, 'manifest.version')
  if (!capabilityKinds.has(text(manifest.kind, 'manifest.kind'))) throw new Error('manifest.kind is invalid')
  text(manifest.description, 'manifest.description', 2000)
  const source = record(manifest.source, 'manifest.source')
  exactKeys(source, ['kind', 'locator', 'revision', 'artifactDigest', 'license', 'supplier', 'signature', 'sbom'], 'manifest.source')
  if (!sourceKinds.has(text(source.kind, 'manifest.source.kind'))) throw new Error('manifest.source.kind is invalid')
  const locator = text(source.locator, 'manifest.source.locator', 1000)
  if (absolutePathPattern.test(locator)) throw new Error('manifest.source.locator must be portable')
  text(source.revision, 'manifest.source.revision', 200)
  digest(source.artifactDigest, 'manifest.source.artifactDigest')
  text(source.license, 'manifest.source.license', 100)
  text(source.supplier, 'manifest.source.supplier', 200)
  const signature = record(source.signature, 'manifest.source.signature')
  exactKeys(signature, ['status', 'keyId'], 'manifest.source.signature')
  const signatureStatus = text(signature.status, 'manifest.source.signature.status')
  if (!['verified', 'missing', 'invalid'].includes(signatureStatus)) throw new Error('manifest.source.signature.status is invalid')
  const signatureKeyId = optionalText(signature.keyId, 'manifest.source.signature.keyId', 300)
  if (signatureStatus === 'verified' && !signatureKeyId) throw new Error('verified manifest source signature requires keyId')
  const sbom = record(source.sbom, 'manifest.source.sbom')
  exactKeys(sbom, ['format', 'digest'], 'manifest.source.sbom')
  const sbomFormat = text(sbom.format, 'manifest.source.sbom.format')
  if (!['spdx', 'cyclonedx', 'none'].includes(sbomFormat)) throw new Error('manifest.source.sbom.format is invalid')
  const sbomDigest = sbom.digest === undefined ? undefined : digest(sbom.digest, 'manifest.source.sbom.digest')
  if (sbomFormat !== 'none' && !sbomDigest) throw new Error('manifest source SBOM requires digest')
  if (sbomFormat === 'none' && sbomDigest) throw new Error('manifest source SBOM digest requires a declared format')
  const runtime = record(manifest.runtime, 'manifest.runtime')
  exactKeys(runtime, ['placements', 'isolation', 'supportedPlatforms', 'executorRequirements', 'stateNamespace', 'offlineCapable'], 'manifest.runtime')
  const placements = array(runtime.placements, 'manifest.runtime.placements').map((item, index) => text(item, `manifest.runtime.placements[${index}]`))
  if (!placements.length || placements.some(item => !['local', 'cloud', 'hybrid'].includes(item))) throw new Error('manifest.runtime.placements is invalid')
  unique(placements, 'manifest.runtime.placements')
  if (!isolationKinds.has(text(runtime.isolation, 'manifest.runtime.isolation'))) throw new Error('manifest.runtime.isolation is invalid')
  const supportedPlatforms = array(runtime.supportedPlatforms, 'manifest.runtime.supportedPlatforms').map((item, index) => text(item, `manifest.runtime.supportedPlatforms[${index}]`))
  unique(supportedPlatforms, 'manifest.runtime.supportedPlatforms')
  const executorRequirements = array(runtime.executorRequirements, 'manifest.runtime.executorRequirements').map((item, index) => text(item, `manifest.runtime.executorRequirements[${index}]`))
  unique(executorRequirements, 'manifest.runtime.executorRequirements')
  identifier(runtime.stateNamespace, 'manifest.runtime.stateNamespace')
  boolean(runtime.offlineCapable, 'manifest.runtime.offlineCapable')
  if (runtime.offlineCapable === true && !placements.includes('local') && !placements.includes('hybrid')) throw new Error('offline capability requires local or hybrid placement')
  const requirements = array(manifest.requirements, 'manifest.requirements')
  const requirementKeys = requirements.map((item, index) => {
    const requirement = record(item, `manifest.requirements[${index}]`)
    exactKeys(requirement, ['kind', 'id', 'versionRange', 'placement', 'required'], `manifest.requirements[${index}]`)
    const kind = text(requirement.kind, `manifest.requirements[${index}].kind`)
    if (!['system', 'model', 'executor', 'package', 'network', 'device', 'capability'].includes(kind)) throw new Error('manifest requirement kind is invalid')
    const placement = text(requirement.placement, `manifest.requirements[${index}].placement`)
    if (!placements.includes(placement)) throw new Error('manifest requirement placement is not supported by the capability')
    if (requirement.versionRange !== null) text(requirement.versionRange, `manifest.requirements[${index}].versionRange`, 100)
    boolean(requirement.required, `manifest.requirements[${index}].required`)
    return `${kind}:${identifier(requirement.id, `manifest.requirements[${index}].id`)}:${placement}`
  })
  unique(requirementKeys, 'manifest.requirements')
  const lifecycle = record(manifest.lifecycle, 'manifest.lifecycle')
  const lifecycleActions = ['install', 'load', 'start', 'stop', 'upgrade', 'uninstall', 'recover']
  if (Object.keys(lifecycle).sort().join(',') !== [...lifecycleActions].sort().join(',')) throw new Error('manifest lifecycle must declare every supported action exactly once')
  const lifecycleInterfaceIds: string[] = []
  for (const action of lifecycleActions) {
    const handler = record(lifecycle[action], `manifest.lifecycle.${action}`)
    exactKeys(handler, ['handlerInterface', 'supported', 'approval'], `manifest.lifecycle.${action}`)
    lifecycleInterfaceIds.push(identifier(handler.handlerInterface, `manifest.lifecycle.${action}.handlerInterface`))
    if (typeof handler.supported !== 'boolean' || !['none', 'install', 'session', 'action'].includes(text(handler.approval, `manifest.lifecycle.${action}.approval`))) throw new Error(`manifest.lifecycle.${action} is invalid`)
  }
  const providedInterfaces = new Set<string>()
  const interfaces = array(manifest.interfaces, 'manifest.interfaces').map((item, index) => {
    const entry = record(item, `manifest.interfaces[${index}]`)
    exactKeys(entry, ['kind', 'id', 'version', 'direction', 'inputSchema', 'outputSchema', 'compatibility'], `manifest.interfaces[${index}]`)
    const kind = text(entry.kind, `manifest.interfaces[${index}].kind`)
    if (!interfaceKinds.has(kind)) throw new Error('manifest interface kind is invalid')
    const id = identifier(entry.id, `manifest.interfaces[${index}].id`)
    version(entry.version, `manifest.interfaces[${index}].version`)
    const direction = text(entry.direction, `manifest.interfaces[${index}].direction`)
    if (!['provides', 'requires'].includes(direction)) throw new Error('manifest interface direction is invalid')
    optionalText(entry.inputSchema, `manifest.interfaces[${index}].inputSchema`, 1000)
    optionalText(entry.outputSchema, `manifest.interfaces[${index}].outputSchema`, 1000)
    const compatibility = array(entry.compatibility, `manifest.interfaces[${index}].compatibility`).map((item, compatIndex) => text(item, `manifest.interfaces[${index}].compatibility[${compatIndex}]`, 100))
    unique(compatibility, `manifest.interfaces[${index}].compatibility`)
    if (direction === 'provides') providedInterfaces.add(id)
    return `${kind}:${id}:${direction}`
  })
  unique(interfaces, 'manifest.interfaces')
  for (const handlerInterface of lifecycleInterfaceIds) {
    if (!providedInterfaces.has(handlerInterface)) throw new Error(`manifest lifecycle handler interface ${handlerInterface} is not declared as provided`)
  }
  const dependencies = array(manifest.dependencies, 'manifest.dependencies').map((item, index) => {
    const dependency = record(item, `manifest.dependencies[${index}]`)
    exactKeys(dependency, ['id', 'versionRange', 'required', 'placement'], `manifest.dependencies[${index}]`)
    const id = identifier(dependency.id, `manifest.dependencies[${index}].id`)
    text(dependency.versionRange, `manifest.dependencies[${index}].versionRange`, 100)
    boolean(dependency.required, `manifest.dependencies[${index}].required`)
    if (dependency.placement !== undefined && !['local', 'cloud', 'hybrid'].includes(text(dependency.placement, `manifest.dependencies[${index}].placement`))) throw new Error('manifest dependency placement is invalid')
    return id
  })
  unique(dependencies, 'manifest.dependencies')
  if (dependencies.includes(manifest.id as string)) throw new Error('manifest cannot depend on itself')
  const permissions = array(manifest.permissions, 'manifest.permissions')
  permissions.forEach((item, index) => validatePermission(item, placements, `manifest.permissions[${index}]`))
  const permissionIds = permissions.map((item, index) => identifier(record(item, `manifest.permissions[${index}]`).id, `manifest.permissions[${index}].id`))
  unique(permissionIds, 'manifest.permissions')
  const manifestDataClasses = array(manifest.dataClasses, 'manifest.dataClasses').map((item, index) => text(item, `manifest.dataClasses[${index}]`, 100))
  unique(manifestDataClasses, 'manifest.dataClasses')
  for (const [index, item] of permissions.entries()) {
    const declared = array(record(item, `manifest.permissions[${index}]`).dataClasses, `manifest.permissions[${index}].dataClasses`)
    if (declared.some(item => !manifestDataClasses.includes(String(item)))) throw new Error('manifest permission data class is not declared by the manifest')
  }
  const tests = array(manifest.tests, 'manifest.tests')
  const testIds = tests.map((item, index) => {
    const declaration = record(item, `manifest.tests[${index}]`)
    exactKeys(declaration, ['id', 'kind', 'required', 'effectMode'], `manifest.tests[${index}]`)
    const kind = text(declaration.kind, `manifest.tests[${index}].kind`)
    if (!['contract', 'fixture', 'redacted-replay', 'health', 'shadow'].includes(kind)) throw new Error('manifest test kind is invalid')
    boolean(declaration.required, `manifest.tests[${index}].required`)
    if (!['none', 'recording-sink'].includes(text(declaration.effectMode, `manifest.tests[${index}].effectMode`))) throw new Error('manifest tests cannot enable effects')
    return identifier(declaration.id, `manifest.tests[${index}].id`)
  })
  unique(testIds, 'manifest.tests')
  if (!tests.some(item => record(item, 'manifest.tests item').kind === 'contract' && record(item, 'manifest.tests item').required === true)) throw new Error('manifest requires a contract test')
  const healthCheckIds = array(manifest.healthChecks, 'manifest.healthChecks').map((item, index) => {
    const check = record(item, `manifest.healthChecks[${index}]`)
    exactKeys(check, ['id', 'interfaceId', 'placement', 'timeoutMs', 'required'], `manifest.healthChecks[${index}]`)
    const placement = text(check.placement, `manifest.healthChecks[${index}].placement`)
    if (!placements.includes(placement)) throw new Error('manifest health check placement is not supported by the capability')
    if (!Number.isSafeInteger(check.timeoutMs) || Number(check.timeoutMs) <= 0) throw new Error('manifest health check timeout must be a positive integer')
    const interfaceId = identifier(check.interfaceId, `manifest.healthChecks[${index}].interfaceId`)
    if (!providedInterfaces.has(interfaceId)) throw new Error('manifest health check interface is not declared as provided')
    boolean(check.required, `manifest.healthChecks[${index}].required`)
    return identifier(check.id, `manifest.healthChecks[${index}].id`)
  })
  unique(healthCheckIds, 'manifest.healthChecks')
  const recovery = record(manifest.recovery, 'manifest.recovery')
  exactKeys(recovery, ['strategy', 'rollbackVersion', 'stateIncluded', 'restoreEffectsEnabled'], 'manifest.recovery')
  if (!['stateless', 'reinstall', 'snapshot', 'encrypted-state'].includes(text(recovery.strategy, 'manifest.recovery.strategy'))) throw new Error('manifest recovery strategy is invalid')
  if (recovery.rollbackVersion !== null) version(recovery.rollbackVersion, 'manifest.recovery.rollbackVersion')
  boolean(recovery.stateIncluded, 'manifest.recovery.stateIncluded')
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

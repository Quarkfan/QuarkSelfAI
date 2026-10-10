export const WORK_INTEGRATION_CONTRACT_VERSION = '1.0.0' as const

export type WorkContributionKindV1 = 'context-enricher' | 'workflow-definition' | 'effect-handler-factory' | 'capability-schema'
export type WorkOwnershipSemanticsV1 = 'exclusive' | 'aggregate'

export interface WorkContributionV1 {
  readonly id: string
  readonly version: string
  readonly kind: WorkContributionKindV1
  readonly ownershipKey: string
  readonly ownershipSemantics: WorkOwnershipSemanticsV1
  readonly effectMode: 'none' | 'recording-only'
}

export interface WorkPackManifestV1 {
  readonly schemaVersion: 1
  readonly packId: string
  readonly packVersion: string
  readonly source: { readonly revision: string; readonly artifactDigest: string }
  readonly contract: { readonly version: typeof WORK_INTEGRATION_CONTRACT_VERSION }
  readonly contributions: readonly WorkContributionV1[]
  readonly requiredHostCapabilities: readonly string[]
  readonly dataClasses: readonly string[]
  readonly recovery: { readonly stateNamespace: string; readonly restoreEffectsEnabled: false }
}

export interface WorkPackRegistrationV1 {
  readonly schemaVersion: 1
  readonly packId: string
  readonly packVersion: string
  readonly contractVersion: typeof WORK_INTEGRATION_CONTRACT_VERSION
  readonly contributions: readonly WorkContributionV1[]
}

export interface WorkExecutionContextV1 {
  readonly schemaVersion: 1
  readonly actionId: string
  readonly mode: 'offline-contract' | 'shadow-recording' | 'live'
  readonly approvalRef: string | null
  readonly idempotencyKey: string
  readonly objective: string
  readonly inputs: Readonly<Record<string, JsonValue>>
  readonly sourceReferences: readonly {
    readonly kind: string
    readonly dataClass: string
    readonly opaqueReference: string
  }[]
  readonly workspace: {
    readonly handle: string | null
    readonly access: 'none' | 'read' | 'write'
    readonly locality: 'local' | 'remote'
  }
  readonly capabilities: readonly { readonly id: string; readonly version: string }[]
  readonly executor: {
    readonly requested: string
    readonly actual: string
    readonly fallbackAllowed: boolean
    readonly midActionSwitchAllowed: false
    readonly continuityKey: string | null
    readonly priorFailureStage: string | null
  }
}

export interface WorkHostPortsV1 {
  readonly contractVersion: typeof WORK_INTEGRATION_CONTRACT_VERSION
  readonly enqueueDurableAction: (input: Readonly<Record<string, JsonValue>>) => Promise<{ readonly actionId: string }>
  readonly registerWorkflowDefinition: (input: Readonly<Record<string, JsonValue>>) => Promise<void>
  readonly registerEffectFactory: (input: Readonly<Record<string, JsonValue>>) => Promise<void>
  readonly verifyApproval: (approvalRef: string, scope: string) => Promise<boolean>
  readonly invokeExecutor: (context: WorkExecutionContextV1) => Promise<{ readonly resultReference: string }>
  readonly resolveWorkspaceHandle: (handle: string, access: 'read' | 'write') => Promise<{ readonly localPath: string }>
  readonly now: () => string
  readonly createId: (namespace: string) => string
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const contributionFields = new Set(['id', 'version', 'kind', 'ownershipKey', 'ownershipSemantics', 'effectMode'])
const contributionKinds = new Set<WorkContributionKindV1>(['context-enricher', 'workflow-definition', 'effect-handler-factory', 'capability-schema'])

export function validateWorkPackManifestV1(value: unknown): WorkPackManifestV1 {
  const manifest = record(value, 'work pack manifest')
  exactFields(manifest, ['schemaVersion', 'packId', 'packVersion', 'source', 'contract', 'contributions', 'requiredHostCapabilities', 'dataClasses', 'recovery'], 'work pack manifest')
  if (manifest.schemaVersion !== 1) throw new Error('unsupported work pack manifest schema')
  const source = record(manifest.source, 'work pack source'); exactFields(source, ['revision', 'artifactDigest'], 'work pack source')
  const contract = record(manifest.contract, 'work pack contract'); exactFields(contract, ['version'], 'work pack contract')
  const recovery = record(manifest.recovery, 'work pack recovery'); exactFields(recovery, ['stateNamespace', 'restoreEffectsEnabled'], 'work pack recovery')
  const result: WorkPackManifestV1 = {
    schemaVersion: 1,
    packId: identifier(manifest.packId, 'pack id'),
    packVersion: version(manifest.packVersion, 'pack version'),
    source: { revision: gitRevision(source.revision), artifactDigest: digest(source.artifactDigest) },
    contract: { version: contractVersion(contract.version) },
    contributions: contributions(manifest.contributions),
    requiredHostCapabilities: identifiers(manifest.requiredHostCapabilities, 'required host capabilities'),
    dataClasses: identifiers(manifest.dataClasses, 'data classes'),
    recovery: {
      stateNamespace: identifier(recovery.stateNamespace, 'state namespace'),
      restoreEffectsEnabled: literalFalse(recovery.restoreEffectsEnabled, 'restore effects'),
    },
  }
  if (result.recovery.stateNamespace !== result.packId) throw new Error('work pack state namespace must equal pack id')
  return deepFreeze(result)
}

export function validateWorkPackRegistrationV1(value: unknown): WorkPackRegistrationV1 {
  const registration = record(value, 'work pack registration')
  exactFields(registration, ['schemaVersion', 'packId', 'packVersion', 'contractVersion', 'contributions'], 'work pack registration')
  if (registration.schemaVersion !== 1) throw new Error('unsupported work pack registration schema')
  return deepFreeze({
    schemaVersion: 1,
    packId: identifier(registration.packId, 'pack id'),
    packVersion: version(registration.packVersion, 'pack version'),
    contractVersion: contractVersion(registration.contractVersion),
    contributions: contributions(registration.contributions),
  })
}

export function validateWorkExecutionContextV1(value: unknown): WorkExecutionContextV1 {
  const context = record(value, 'work execution context')
  exactFields(context, ['schemaVersion', 'actionId', 'mode', 'approvalRef', 'idempotencyKey', 'objective', 'inputs', 'sourceReferences', 'workspace', 'capabilities', 'executor'], 'work execution context')
  if (context.schemaVersion !== 1) throw new Error('unsupported work execution context schema')
  if (!['offline-contract', 'shadow-recording', 'live'].includes(String(context.mode))) throw new Error('invalid work execution mode')
  const workspace = record(context.workspace, 'workspace'); exactFields(workspace, ['handle', 'access', 'locality'], 'workspace')
  if (!['none', 'read', 'write'].includes(String(workspace.access)) || !['local', 'remote'].includes(String(workspace.locality))) throw new Error('invalid workspace request')
  const handle = nullableIdentifier(workspace.handle, 'workspace handle')
  if ((workspace.access === 'none') !== (handle === null)) throw new Error('workspace handle and access must agree')
  const executor = record(context.executor, 'executor'); exactFields(executor, ['requested', 'actual', 'fallbackAllowed', 'midActionSwitchAllowed', 'continuityKey', 'priorFailureStage'], 'executor')
  if (typeof executor.fallbackAllowed !== 'boolean' || executor.midActionSwitchAllowed !== false) throw new Error('unsafe executor fallback policy')
  const inputs = jsonRecord(context.inputs, 'inputs')
  const sourceReferences = array(context.sourceReferences, 'source references', 32).map((item, index) => {
    const ref = record(item, `source reference ${index}`); exactFields(ref, ['kind', 'dataClass', 'opaqueReference'], `source reference ${index}`)
    const opaqueReference = boundedString(ref.opaqueReference, 'opaque reference', 256)
    rejectSensitiveOrPath(opaqueReference, 'opaque reference')
    return { kind: identifier(ref.kind, 'source kind'), dataClass: identifier(ref.dataClass, 'source data class'), opaqueReference }
  })
  const capabilities = array(context.capabilities, 'capabilities', 64).map((item, index) => {
    const capability = record(item, `capability ${index}`); exactFields(capability, ['id', 'version'], `capability ${index}`)
    return { id: identifier(capability.id, 'capability id'), version: version(capability.version, 'capability version') }
  })
  return deepFreeze({
    schemaVersion: 1,
    actionId: identifier(context.actionId, 'action id'),
    mode: context.mode as WorkExecutionContextV1['mode'],
    approvalRef: nullableIdentifier(context.approvalRef, 'approval reference'),
    idempotencyKey: identifier(context.idempotencyKey, 'idempotency key'),
    objective: boundedString(context.objective, 'objective', 4000),
    inputs,
    sourceReferences,
    workspace: { handle, access: workspace.access as WorkExecutionContextV1['workspace']['access'], locality: workspace.locality as 'local' | 'remote' },
    capabilities,
    executor: {
      requested: identifier(executor.requested, 'requested executor'),
      actual: identifier(executor.actual, 'actual executor'),
      fallbackAllowed: executor.fallbackAllowed,
      midActionSwitchAllowed: false,
      continuityKey: nullableIdentifier(executor.continuityKey, 'continuity key'),
      priorFailureStage: nullableIdentifier(executor.priorFailureStage, 'prior failure stage'),
    },
  })
}

export function canonicalWorkExecutionContextV1(value: unknown): { readonly context: WorkExecutionContextV1; readonly bytes: string } {
  const context = validateWorkExecutionContextV1(value)
  const bytes = canonicalJson(context)
  return { context, bytes }
}

function contributions(value: unknown): readonly WorkContributionV1[] {
  const seen = new Set<string>()
  return array(value, 'contributions', 128).map((item, index) => {
    const input = record(item, `contribution ${index}`); exactFields(input, [...contributionFields], `contribution ${index}`)
    const contribution: WorkContributionV1 = {
      id: identifier(input.id, 'contribution id'), version: version(input.version, 'contribution version'),
      kind: input.kind as WorkContributionKindV1,
      ownershipKey: identifier(input.ownershipKey, 'ownership key'),
      ownershipSemantics: input.ownershipSemantics as WorkOwnershipSemanticsV1,
      effectMode: input.effectMode as 'none' | 'recording-only',
    }
    if (!contributionKinds.has(contribution.kind) || !['exclusive', 'aggregate'].includes(contribution.ownershipSemantics) || !['none', 'recording-only'].includes(contribution.effectMode)) throw new Error(`invalid contribution ${index}`)
    if (seen.has(contribution.id)) throw new Error(`duplicate contribution id: ${contribution.id}`)
    seen.add(contribution.id)
    return contribution
  })
}

function record(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value as Record<string, unknown> }
function exactFields(value: Record<string, unknown>, allowed: readonly string[], name: string): void { const extra = Object.keys(value).filter(key => !allowed.includes(key)); if (extra.length) throw new Error(`${name} has unknown fields: ${extra.join(', ')}`); if (allowed.some(key => !(key in value))) throw new Error(`${name} is incomplete`) }
function array(value: unknown, name: string, max: number): readonly unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be an array of at most ${max}`); return value }
function boundedString(value: unknown, name: string, max: number): string { if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new Error(`${name} must be a bounded string`); return value }
function identifier(value: unknown, name: string): string { const result = boundedString(value, name, 160); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) throw new Error(`${name} is invalid`); return result }
function identifiers(value: unknown, name: string): readonly string[] { const values = array(value, name, 128).map(item => identifier(item, name)); if (new Set(values).size !== values.length) throw new Error(`${name} contains duplicates`); return values }
function nullableIdentifier(value: unknown, name: string): string | null { return value === null ? null : identifier(value, name) }
function version(value: unknown, name: string): string { const result = boundedString(value, name, 64); if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(result)) throw new Error(`${name} is invalid`); return result }
function gitRevision(value: unknown): string { const result = boundedString(value, 'source revision', 40); if (!/^[a-f0-9]{40}$/u.test(result)) throw new Error('source revision must be an exact Git SHA'); return result }
function digest(value: unknown): string { const result = boundedString(value, 'artifact digest', 71); if (!/^sha256:[a-f0-9]{64}$/u.test(result)) throw new Error('artifact digest is invalid'); return result }
function contractVersion(value: unknown): typeof WORK_INTEGRATION_CONTRACT_VERSION { if (value !== WORK_INTEGRATION_CONTRACT_VERSION) throw new Error('unsupported work integration contract version'); return value }
function literalFalse(value: unknown, name: string): false { if (value !== false) throw new Error(`${name} must remain false`); return false }
function jsonRecord(value: unknown, name: string): Readonly<Record<string, JsonValue>> { const result = record(value, name); JSON.stringify(result); rejectSensitiveOrPath(JSON.stringify(result), name); return result as Readonly<Record<string, JsonValue>> }
function rejectSensitiveOrPath(value: string, name: string): void { if (/(?:^|\W)(?:token|password|secret|cookie|authorization)(?:\W|$)/iu.test(value) || /(?:^|["'])\/(?:Users|home|var|private|etc)\//u.test(value)) throw new Error(`${name} contains sensitive or host-path material`) }
function canonicalJson(value: unknown): string { if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}` }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested) } return value }

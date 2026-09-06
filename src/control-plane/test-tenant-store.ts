import type {
  BlueprintReleaseRecordV1, CapabilityReleaseRecordV1, DeviceRecordV1, DispatchRecordV1, RedactedResultV1,
  TenantAuditRecordV1, TenantContextV1, TenantRecordV1, TestTenantControlPlanePortV1, UserRecordV1,
} from './contracts.js'

type Partition = {
  tenant: TenantRecordV1
  users: Map<string, UserRecordV1>
  devices: Map<string, DeviceRecordV1>
  capabilities: Map<string, CapabilityReleaseRecordV1>
  blueprints: Map<string, BlueprintReleaseRecordV1>
  dispatches: Map<string, DispatchRecordV1>
  results: Map<string, RedactedResultV1>
  audits: TenantAuditRecordV1[]
}

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const unsafeText = /(?:^|[\\/])Users[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

function validId(value: string, label: string): void {
  if (!idPattern.test(value)) throw new Error(`${label} is invalid`)
}

/** Reference control plane for isolation tests. It has no listener, persistence adapter, scheduler or runtime mount. */
export class InactiveTestTenantControlPlaneV1 implements TestTenantControlPlanePortV1 {
  readonly #partitions = new Map<string, Partition>()

  createTestTenant(input: { readonly tenantId: string; readonly name: string }, now = new Date()): TenantRecordV1 {
    validId(input.tenantId, 'tenantId')
    if (!input.tenantId.startsWith('test.')) throw new Error('inactive control plane accepts test tenants only')
    if (!input.name || unsafeText.test(input.name)) throw new Error('tenant name is unsafe')
    if (this.#partitions.has(input.tenantId)) throw new Error('tenant already exists')
    const tenant = Object.freeze({ tenantId: input.tenantId, name: input.name, state: 'test' as const, createdAt: now.toISOString() })
    this.#partitions.set(input.tenantId, { tenant, users: new Map(), devices: new Map(), capabilities: new Map(), blueprints: new Map(), dispatches: new Map(), results: new Map(), audits: [] })
    return tenant
  }

  registerUser(context: TenantContextV1, input: { readonly userId: string; readonly displayName: string }, now = new Date()): UserRecordV1 {
    const partition = this.#ownerPartition(context)
    validId(input.userId, 'userId')
    if (!input.displayName || unsafeText.test(input.displayName)) throw new Error('displayName is unsafe')
    const existing = partition.users.get(input.userId)
    if (existing) return existing
    const user = Object.freeze({ tenantId: context.tenantId, userId: input.userId, displayName: input.displayName, state: 'active' as const, createdAt: now.toISOString() })
    partition.users.set(input.userId, user)
    this.#audit(partition, context, 'user.register', `user:${input.userId}`, 'allowed', now)
    return user
  }

  registerDevice(context: TenantContextV1, input: { readonly deviceId: string; readonly publicKey: string }, now = new Date()): DeviceRecordV1 {
    const partition = this.#partition(context)
    this.#requireKnownUser(partition, context.userId)
    validId(input.deviceId, 'deviceId')
    if (!input.publicKey || unsafeText.test(input.publicKey)) throw new Error('device public key is unsafe')
    const device = Object.freeze({ tenantId: context.tenantId, userId: context.userId, deviceId: input.deviceId, publicKey: input.publicKey, state: 'registered' as const, createdAt: now.toISOString() })
    partition.devices.set(input.deviceId, device)
    this.#audit(partition, context, 'device.register', `device:${input.deviceId}`, 'allowed', now)
    return device
  }

  publishCapability(context: TenantContextV1, input: Omit<CapabilityReleaseRecordV1, 'tenantId' | 'createdAt'>, now = new Date()): CapabilityReleaseRecordV1 {
    const partition = this.#ownerPartition(context)
    const key = `${input.capabilityId}@${input.version}`
    const existing = partition.capabilities.get(key)
    if (existing && existing.artifactDigest !== input.artifactDigest) throw new Error('immutable capability release already exists with another digest')
    if (existing) return existing
    const release = Object.freeze({ ...input, tenantId: context.tenantId, createdAt: now.toISOString() })
    partition.capabilities.set(key, release)
    this.#audit(partition, context, 'capability.publish', `capability:${key}`, 'allowed', now)
    return release
  }

  publishBlueprint(context: TenantContextV1, input: Omit<BlueprintReleaseRecordV1, 'tenantId' | 'createdAt'>, now = new Date()): BlueprintReleaseRecordV1 {
    const partition = this.#ownerPartition(context)
    const key = `${input.blueprintId}@${input.version}`
    const existing = partition.blueprints.get(key)
    if (existing && existing.blueprintDigest !== input.blueprintDigest) throw new Error('immutable blueprint release already exists with another digest')
    if (existing) return existing
    const release = Object.freeze({ ...input, tenantId: context.tenantId, createdAt: now.toISOString() })
    partition.blueprints.set(key, release)
    this.#audit(partition, context, 'blueprint.publish', `blueprint:${key}`, 'allowed', now)
    return release
  }

  dispatch(context: TenantContextV1, input: Omit<DispatchRecordV1, 'tenantId' | 'userId' | 'state' | 'createdAt'>, now = new Date()): DispatchRecordV1 {
    const partition = this.#partition(context)
    this.#requireKnownUser(partition, context.userId)
    const device = partition.devices.get(input.deviceId)
    if (!device || device.userId !== context.userId) throw new Error('dispatch device is outside the tenant user scope')
    if (input.plan.envelope.tenantId !== context.tenantId || input.plan.envelope.userId !== context.userId || input.plan.envelope.deviceId !== input.deviceId) throw new Error('signed plan scope does not match dispatch scope')
    if (input.plan.envelope.allowedEffects.length || input.plan.envelope.approvalGrants.length) throw new Error('inactive control plane accepts only no-effect test dispatches')
    const duplicate = [...partition.dispatches.values()].find(item => item.idempotencyKey === input.idempotencyKey)
    if (duplicate) return duplicate
    const record = Object.freeze({ ...input, tenantId: context.tenantId, userId: context.userId, state: 'queued' as const, createdAt: now.toISOString() })
    partition.dispatches.set(input.taskId, record)
    this.#audit(partition, context, 'task.dispatch', `task:${input.taskId}`, 'allowed', now)
    return record
  }

  acknowledgeLease(context: TenantContextV1, input: { readonly taskId: string; readonly planId: string; readonly deviceId: string }, now = new Date()): DispatchRecordV1 {
    const partition = this.#partition(context)
    const dispatch = partition.dispatches.get(input.taskId)
    if (!dispatch || dispatch.userId !== context.userId || dispatch.deviceId !== input.deviceId || dispatch.plan.planId !== input.planId) throw new Error('lease acknowledgement is outside the task scope')
    if (dispatch.state !== 'queued' && dispatch.state !== 'leased') throw new Error('task cannot enter leased state')
    if (dispatch.state === 'leased') return dispatch
    const leased = Object.freeze({ ...dispatch, state: 'leased' as const })
    partition.dispatches.set(input.taskId, leased)
    this.#audit(partition, context, 'task.lease', `task:${input.taskId}`, 'allowed', now)
    return leased
  }

  complete(context: TenantContextV1, input: Omit<RedactedResultV1, 'tenantId' | 'userId'>): RedactedResultV1 {
    const partition = this.#partition(context)
    const dispatch = partition.dispatches.get(input.taskId)
    if (!dispatch || dispatch.userId !== context.userId || dispatch.deviceId !== input.deviceId || dispatch.plan.planId !== input.planId) throw new Error('result task, device or plan is outside the leased scope')
    if (dispatch.state !== 'leased' && !partition.results.has(input.taskId)) throw new Error('result requires an acknowledged task lease')
    if (!input.summaryCode || unsafeText.test(input.summaryCode)) throw new Error('result must be privacy bounded')
    if (!input.artifactDigests.every(value => /^sha256:[a-f0-9]{64}$/.test(value)) || Number.isNaN(Date.parse(input.completedAt))) throw new Error('result evidence is invalid')
    const existing = partition.results.get(input.taskId)
    if (existing) {
      const proposed = { ...input, tenantId: context.tenantId, userId: context.userId }
      if (JSON.stringify(existing) !== JSON.stringify(proposed)) throw new Error('immutable task result already exists with different evidence')
      return existing
    }
    const result = Object.freeze({ ...input, tenantId: context.tenantId, userId: context.userId })
    partition.results.set(input.taskId, result)
    const state = input.outcome === 'succeeded' ? 'completed' : input.outcome
    partition.dispatches.set(input.taskId, Object.freeze({ ...dispatch, state }))
    this.#audit(partition, context, 'task.complete', `task:${input.taskId}`, 'allowed', new Date(input.completedAt))
    return result
  }

  listAudits(context: TenantContextV1): readonly TenantAuditRecordV1[] {
    const partition = this.#partition(context)
    if (!context.roles.some(role => role === 'owner' || role === 'auditor')) throw new Error('tenant audit role is required')
    return [...partition.audits]
  }

  getDevice(context: TenantContextV1, deviceId: string): DeviceRecordV1 | undefined {
    const device = this.#partition(context).devices.get(deviceId)
    return device && (device.userId === context.userId || context.roles.some(role => role === 'owner' || role === 'auditor')) ? device : undefined
  }

  getDispatch(context: TenantContextV1, taskId: string): DispatchRecordV1 | undefined {
    const dispatch = this.#partition(context).dispatches.get(taskId)
    return dispatch && (dispatch.userId === context.userId || context.roles.some(role => role === 'owner' || role === 'auditor')) ? dispatch : undefined
  }

  #partition(context: TenantContextV1): Partition {
    validId(context.tenantId, 'context.tenantId')
    validId(context.userId, 'context.userId')
    const partition = this.#partitions.get(context.tenantId)
    if (!partition) throw new Error('tenant is unavailable')
    return partition
  }

  #ownerPartition(context: TenantContextV1): Partition {
    if (!context.roles.includes('owner')) throw new Error('tenant owner role is required')
    return this.#partition(context)
  }

  #requireKnownUser(partition: Partition, userId: string): void {
    if (!partition.users.has(userId)) throw new Error('tenant user is unavailable')
  }

  #audit(partition: Partition, context: TenantContextV1, action: string, subjectRef: string, outcome: 'allowed' | 'denied', now: Date): void {
    partition.audits.push(Object.freeze({ tenantId: context.tenantId, auditId: `audit.${partition.audits.length + 1}`, actorUserId: context.userId, action, subjectRef, outcome, occurredAt: now.toISOString() }))
  }
}

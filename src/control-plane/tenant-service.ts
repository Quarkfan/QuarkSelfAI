import type { DeviceRecordV1, TenantContextV1, TenantRecordV1, UserRecordV1 } from './contracts.js'
import type { TenantAuthorizationPortV1, TenantControlActionV1, TenantControlRepositoryV1 } from './tenant-persistence.js'

const idPattern = /^[a-z0-9][a-z0-9.-]{0,63}$/
const unsafeText = /(?:^|[\\/])Users[\\/]|(?:token|secret|password|private[_-]?key)\s*[:=]/i

/** Multi-tenant application service. It has no listener or implicit administrator role. */
export class TenantControlServiceV1 {
  constructor(private readonly repository: TenantControlRepositoryV1, private readonly authorization: TenantAuthorizationPortV1) {}

  async createTenant(context: TenantContextV1, input: { readonly name: string }, now = new Date()): Promise<TenantRecordV1> {
    validateContext(context)
    if (!context.roles.includes('owner')) throw new Error('tenant creation requires owner role')
    await this.#authorize(context, 'tenant.create', `tenant:${context.tenantId}`)
    if (!safeText(input.name)) throw new Error('tenant name is unsafe')
    return await this.repository.createTenant(Object.freeze({ tenantId: context.tenantId, name: input.name, state: 'active', createdAt: validNow(now) }))
  }

  async registerUser(context: TenantContextV1, input: { readonly userId: string; readonly displayName: string }, now = new Date()): Promise<UserRecordV1> {
    validateContext(context)
    if (!context.roles.includes('owner')) throw new Error('user registration requires tenant owner role')
    await this.#knownTenant(context.tenantId)
    validId(input.userId, 'userId')
    if (!safeText(input.displayName)) throw new Error('displayName is unsafe')
    await this.#authorize(context, 'user.register', `user:${input.userId}`)
    return await this.repository.putUser(Object.freeze({ tenantId: context.tenantId, userId: input.userId, displayName: input.displayName, state: 'active', createdAt: validNow(now) }))
  }

  async registerDevice(context: TenantContextV1, input: { readonly deviceId: string; readonly publicKey: string }, now = new Date()): Promise<DeviceRecordV1> {
    validateContext(context)
    await this.#knownTenant(context.tenantId)
    if (!await this.repository.getUser(context.tenantId, context.userId)) throw new Error('device owner is not registered in tenant')
    validId(input.deviceId, 'deviceId')
    if (!safeText(input.publicKey)) throw new Error('device public key is unsafe')
    await this.#authorize(context, 'device.register', `device:${input.deviceId}`)
    return await this.repository.putDevice(Object.freeze({ tenantId: context.tenantId, userId: context.userId, deviceId: input.deviceId, publicKey: input.publicKey, state: 'registered', createdAt: validNow(now) }))
  }

  async listDevices(context: TenantContextV1): Promise<readonly DeviceRecordV1[]> {
    validateContext(context)
    await this.#knownTenant(context.tenantId)
    await this.#authorize(context, 'device.list', `user:${context.userId}`)
    return await this.repository.listDevices(context.tenantId, context.roles.some(role => role === 'owner' || role === 'auditor') ? undefined : context.userId)
  }

  async #knownTenant(tenantId: string): Promise<void> {
    if (!await this.repository.getTenant(tenantId)) throw new Error('tenant is unavailable')
  }

  async #authorize(context: TenantContextV1, action: TenantControlActionV1, subjectRef: string): Promise<void> {
    if (!await this.authorization.authorize({ context, action, subjectRef })) throw new Error('tenant operation is not authorized')
  }
}

/** Closed default authorization for authenticated tenant roles; it grants no cross-tenant or external-effect action. */
export class RoleTenantAuthorizationV1 implements TenantAuthorizationPortV1 {
  async authorize(input: { readonly context: TenantContextV1; readonly action: TenantControlActionV1; readonly subjectRef: string }): Promise<boolean> {
    validateContext(input.context)
    if (!/^[a-z][a-z-]{1,31}:[a-z0-9][a-z0-9._:@/-]{0,255}$/.test(input.subjectRef)) return false
    if (input.context.roles.includes('owner')) return true
    const read = new Set<TenantControlActionV1>(['device.list', 'agent-draft.read', 'capability-release.read'])
    if (input.context.roles.includes('auditor')) return read.has(input.action)
    const member = new Set<TenantControlActionV1>([...read, 'device.register', 'agent-draft.write', 'agent-release.publish-test', 'capability-release.register-inactive'])
    return input.context.roles.includes('member') && member.has(input.action)
  }
}

function validateContext(context: TenantContextV1): void {
  validId(context.tenantId, 'tenantId')
  validId(context.userId, 'userId')
  if (!context.roles.length || new Set(context.roles).size !== context.roles.length || context.roles.some(role => !['owner', 'member', 'auditor'].includes(role))) throw new Error('tenant roles are invalid')
}

function validId(value: string, label: string): void {
  if (!idPattern.test(value)) throw new Error(`${label} is invalid`)
}

function safeText(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 500 && !unsafeText.test(value)
}

function validNow(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error('timestamp is invalid')
  return now.toISOString()
}

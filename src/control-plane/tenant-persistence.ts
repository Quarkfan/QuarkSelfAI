import type { DeviceRecordV1, TenantContextV1, TenantRecordV1, UserRecordV1 } from './contracts.js'

export type TenantControlActionV1 =
  | 'tenant.create'
  | 'user.register'
  | 'device.register'
  | 'device.list'
  | 'agent-draft.read'
  | 'agent-draft.write'
  | 'agent-release.publish-test'

export interface TenantAuthorizationPortV1 {
  authorize(input: {
    readonly context: TenantContextV1
    readonly action: TenantControlActionV1
    readonly subjectRef: string
  }): Promise<boolean>
}

export interface TenantControlRepositoryV1 {
  createTenant(input: TenantRecordV1): Promise<TenantRecordV1>
  getTenant(tenantId: string): Promise<TenantRecordV1 | undefined>
  putUser(input: UserRecordV1): Promise<UserRecordV1>
  getUser(tenantId: string, userId: string): Promise<UserRecordV1 | undefined>
  putDevice(input: DeviceRecordV1): Promise<DeviceRecordV1>
  getDevice(tenantId: string, deviceId: string): Promise<DeviceRecordV1 | undefined>
  listDevices(tenantId: string, userId?: string): Promise<readonly DeviceRecordV1[]>
  close(): Promise<void>
}

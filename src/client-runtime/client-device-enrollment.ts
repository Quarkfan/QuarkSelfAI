import { createHash } from 'node:crypto'
import type { DeviceEnrollmentServerPortV1, DeviceEnrollmentStatusV1 } from '../control-plane/contracts.js'
import type { ClientDeviceEnrollmentViewV1, LocalDeviceEnrollmentStateV1, RemovableLocalDeviceSecretStoreV1 } from './contracts.js'
import type { SqliteInactiveClientStateV1 } from './sqlite-client-state.js'

/** Resumable local half of device-code enrollment. Poll credentials stay encrypted and never enter its public view. */
export class InactiveClientDeviceEnrollmentV1 {
  constructor(private readonly state: SqliteInactiveClientStateV1, private readonly secrets: RemovableLocalDeviceSecretStoreV1, private readonly server: DeviceEnrollmentServerPortV1) {}

  async begin(now = new Date()): Promise<ClientDeviceEnrollmentViewV1> {
    const existing = this.state.deviceEnrollment()
    if (existing?.state === 'expired') this.state.clearExpiredDeviceEnrollment()
    else if (existing) return view(existing)
    const identity = this.state.localEnrollment().identity
    const request = await this.server.begin({ tenantId: identity.tenantId, userId: identity.userId, deviceId: identity.deviceId, publicKey: identity.publicKey }, now)
    validateRequest(request, now)
    const reference = `secret:enrollment.${createHash('sha256').update(request.requestId).digest('hex').slice(0, 32)}`
    const token = Buffer.from(request.pollToken, 'utf8')
    try {
      await this.secrets.put(reference, token)
      try { return view(this.state.savePendingDeviceEnrollment(request, reference, now)) }
      catch (error) { await this.secrets.remove(reference); throw error }
    } finally { token.fill(0) }
  }

  async poll(now = new Date()): Promise<ClientDeviceEnrollmentViewV1> {
    let local = this.state.deviceEnrollment()
    if (!local) throw new Error('local device enrollment is unavailable')
    if (local.state === 'approved' || local.state === 'expired') return view(local)
    if (local.state.endsWith('cleanup-pending')) return await this.#cleanup(local, now)
    const secret = await this.secrets.get(local.pollTokenRef)
    if (!secret) throw new Error('device enrollment poll credential is unavailable')
    let remote: DeviceEnrollmentStatusV1; const credentialBytes = Buffer.from(secret)
    try { remote = await this.server.poll({ requestId: local.requestId, pollToken: credentialBytes.toString('utf8') }, now) }
    finally { credentialBytes.fill(0); secret.fill(0) }
    if (Object.keys(remote).sort().join(',') !== 'deviceId,expiresAt,requestId,schemaVersion,state' || remote.schemaVersion !== 1 || remote.requestId !== local.requestId || remote.deviceId !== local.deviceId || remote.expiresAt !== local.expiresAt || !['pending','approved','expired'].includes(remote.state)) throw new Error('device enrollment server status drifted')
    if (remote.state === 'pending') return view(local)
    local = this.state.advanceDeviceEnrollment(local.requestId, `${remote.state}-cleanup-pending`, now)
    return await this.#cleanup(local, now)
  }

  async #cleanup(local: LocalDeviceEnrollmentStateV1, now: Date): Promise<ClientDeviceEnrollmentViewV1> {
    const final = local.state.startsWith('approved') ? 'approved' : 'expired'
    await this.secrets.remove(local.pollTokenRef)
    return view(this.state.advanceDeviceEnrollment(local.requestId, final, now))
  }
}

function validateRequest(request: Awaited<ReturnType<DeviceEnrollmentServerPortV1['begin']>>, now: Date): void {
  if (Object.keys(request).sort().join(',') !== 'expiresAt,pollAfterSeconds,pollToken,requestId,schemaVersion,userCode,verificationPath' || request.schemaVersion !== 1 || !/^enrollment\.[a-f0-9]{32}$/.test(request.requestId) || !/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(request.userCode) || !/^[A-Za-z0-9_-]{43}$/.test(request.pollToken) || request.verificationPath !== '/devices/activate' || request.pollAfterSeconds !== 5 || Date.parse(request.expiresAt) <= now.getTime()) throw new Error('device enrollment server request is invalid')
}
function view(value: NonNullable<ReturnType<SqliteInactiveClientStateV1['deviceEnrollment']>>): ClientDeviceEnrollmentViewV1 { return Object.freeze({ requestId: value.requestId, userCode: value.userCode, state: value.state.startsWith('approved') ? 'approved' : value.state.startsWith('expired') ? 'expired' : 'pending', verificationPath: '/devices/activate', expiresAt: value.expiresAt, pollAfterSeconds: 5, credentialCleanupPending: value.state.endsWith('cleanup-pending') }) }
